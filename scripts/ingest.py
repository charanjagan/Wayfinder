"""PDF floor plan ingestion pipeline.

Usage: python ingest.py <pdf_path> <output_dir> [--dpi 300] [--cell-size-px 8] [--kernel-size 5]

Emits one JSON object per line (NDJSON) to stdout describing progress:
  {"stage": "rasterizing"}
  {"stage": "extracting_labels"}
  {"stage": "detecting_zones"}
  {"stage": "done", "sourcePixelWidth": W, "sourcePixelHeight": H}
  {"stage": "error", "message": "..."}
"""
import argparse
import json
import os
import re
import sys
import uuid

import cv2
import fitz
import numpy as np

FACILITY_KEYWORDS = [
    "RESTROOM", "BATHROOM", "WASHROOM", "KITCHEN", "PANTRY", "STORAGE",
    "SERVER", "ELECTRICAL", "MECHANICAL", "JANITOR", "UTILITY", "STAIR",
    "ELEVATOR", "LIFT", "AHU", "SUPPLY", "PRINT ROOM", "COPY ROOM",
]
WORKSTATION_RE = re.compile(r"^[A-Z]{1,4}-(WS|PC)-\d+-\d+$")
ZONE_RE = re.compile(r"^ZONE\s*[A-Z0-9]{1,4}$")
TITLE_BLOCK_RIGHT_FRACTION = 0.85
TITLE_BLOCK_BOTTOM_FRACTION = 0.90

# PDFs frequently encode hyphens/spaces in label text with visually-identical but
# distinct codepoints (soft hyphen, non-breaking space, various dash widths) depending
# on the authoring CAD/font toolchain. Classification regexes are ASCII-only, so these
# must be normalized first or every hyphenated ID (e.g. "ZA\xad-WS\xad-31") silently
# fails to match and falls through to the wrong bucket.
DASH_CHARS = "­‐‑‒–—−⁃"
SPACE_CHARS = "   "
_NORMALIZE_TABLE = str.maketrans({**{c: "-" for c in DASH_CHARS}, **{c: " " for c in SPACE_CHARS}})


def normalize_text(text):
    return text.translate(_NORMALIZE_TABLE).strip()


def emit(stage, **kwargs):
    payload = {"stage": stage, **kwargs}
    print(json.dumps(payload), flush=True)


def rasterize(pdf_path, dpi, raster_path):
    doc = fitz.open(pdf_path)
    page = doc[0]
    scale = dpi / 72.0
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    pix.save(raster_path)
    return doc, page, scale, pix.width, pix.height


def build_occupancy_grid(raster_path, dpi, cell_size_px, kernel_size, debug_dir):
    img = cv2.imread(raster_path, cv2.IMREAD_GRAYSCALE)
    h, w = img.shape

    _, thresh = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, kernel)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    min_area = max(25, (w * h) * 0.00005)
    wall_mask = np.zeros_like(opened)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            wall_mask[labels == i] = 255

    cv2.imwrite(os.path.join(debug_dir, "threshold.png"), wall_mask)

    grid_w = max(1, w // cell_size_px)
    grid_h = max(1, h // cell_size_px)
    resized = cv2.resize(wall_mask, (grid_w, grid_h), interpolation=cv2.INTER_AREA)
    grid = (resized > 127).astype(np.uint8)

    preview = np.where(grid == 1, 0, 255).astype(np.uint8)
    preview_upscaled = cv2.resize(preview, (w, h), interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(os.path.join(debug_dir, "grid_preview.png"), preview_upscaled)

    occupancy = {
        "width": grid_w,
        "height": grid_h,
        "cellSizePx": cell_size_px,
        "dpi": dpi,
        "pixelToMm": 25.4 / dpi,
        "sourcePixelWidth": w,
        "sourcePixelHeight": h,
        "grid": grid.tolist(),
    }
    return occupancy


def is_title_block(x, y, w, h):
    return x > w * TITLE_BLOCK_RIGHT_FRACTION or y > h * TITLE_BLOCK_BOTTOM_FRACTION


def classify_text(text):
    """Primary, high-confidence classification. Returns None if undetermined
    (caller falls back to font-size clustering, then plain 'room')."""
    if WORKSTATION_RE.match(text):
        return "workstation"
    if ZONE_RE.match(text):
        return "zone"
    upper = text.upper()
    if any(kw in upper for kw in FACILITY_KEYWORDS):
        return "facility"
    return None


# CAD drawings are dense with dimension chains, elevation callouts, and drawing notes that
# extract as ordinary text spans -- none of that is a wayfinding destination.
DIMENSION_RE = re.compile(r"^[+-]?\d+([.,]\d+)?\s*(MM|M|CM|KM|FT|IN|SQM|SQ\.?\s?FT)?$", re.IGNORECASE)
NOTE_KEYWORDS = [
    "DIMENSIONS ARE", "UNFINISHED DIMENSIONS", "CORRELATED", "CONSULTANT",
    "PRIOR TO EXECUTION", "OTHERWISE SPECIFIED", "LEVELS ARE IN METRES",
]
# Real room names are essentially unique; a bare word repeated many times across the sheet
# (RACK, SINK, COUNTER, DB, ...) is furniture/equipment tagging, not a place. Cap how many
# times an unclassified label may repeat before it's treated as that kind of noise.
REPEAT_NOISE_THRESHOLD = 4


def is_noise_text(text):
    stripped = text.strip()
    if DIMENSION_RE.match(stripped):
        return True
    upper = stripped.upper()
    return any(kw in upper for kw in NOTE_KEYWORDS)


def extract_labels(page, scale, img_w, img_h):
    text_dict = page.get_text("dict")
    spans = []
    for block in text_dict.get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                raw_text = span.get("text", "")
                text = normalize_text(raw_text)
                if not text:
                    continue
                bbox = span["bbox"]
                x = ((bbox[0] + bbox[2]) / 2.0) * scale
                y = ((bbox[1] + bbox[3]) / 2.0) * scale
                spans.append({"text": text, "size": span.get("size", 10.0), "x": x, "y": y})

    spans = [s for s in spans if not is_title_block(s["x"], s["y"], img_w, img_h) and not is_noise_text(s["text"])]
    if not spans:
        return []

    provisional = [(s, classify_text(s["text"])) for s in spans]

    # "ZONE <letter>"-style labels are the reliable signal for zones. Only fall back to
    # font-size clustering (large, isolated, all-caps text) if the document doesn't use
    # that literal convention at all -- otherwise other bold/large infra labels (e.g.
    # "LIFT-1", "AHU") get mistaken for zones, since font size isn't monotonic with
    # semantic role across CAD title-block styles.
    if not any(t == "zone" for _, t in provisional):
        sizes = sorted(s["size"] for s in spans)
        body_size_threshold = sizes[int(len(sizes) * 0.85)] if len(sizes) > 1 else sizes[0]
        body_size_threshold = max(body_size_threshold, sizes[0] + 1e-6)

        def font_fallback(s):
            word_count = len(s["text"].split())
            if s["text"] == s["text"].upper() and word_count <= 4 and s["size"] >= body_size_threshold:
                return "zone"
            return None

        provisional = [(s, t if t is not None else font_fallback(s)) for s, t in provisional]

    unclassified_counts = {}
    for s, t in provisional:
        if t is None:
            key = s["text"].strip().upper()
            unclassified_counts[key] = unclassified_counts.get(key, 0) + 1
    provisional = [
        (s, t) for s, t in provisional
        if not (t is None and unclassified_counts[s["text"].strip().upper()] > REPEAT_NOISE_THRESHOLD)
    ]

    labels = []
    for s, label_type in provisional:
        labels.append({
            "id": f"label_{uuid.uuid4().hex[:8]}",
            "text": s["text"],
            "type": label_type or "room",
            "x": round(s["x"], 2),
            "y": round(s["y"], 2),
            "associatedZone": None,
        })
    return labels


def point_in_polygon(x, y, points):
    n = len(points)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = points[i]
        xj, yj = points[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def detect_zones(raster_path, labels, img_w, img_h, debug_dir):
    color = cv2.imread(raster_path, cv2.IMREAD_COLOR)
    hsv = cv2.cvtColor(color, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]
    colored_mask = np.where(sat > 40, 255, 0).astype(np.uint8)

    kernel = np.ones((5, 5), np.uint8)
    colored_mask = cv2.morphologyEx(colored_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(colored_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    noise_floor = 3000
    fallback_min_area = (img_w * img_h) * 0.002

    zone_name_labels = [l for l in labels if l["type"] == "zone"]

    # Raw stroke-traced contours are unreliable for point-in-polygon: furniture icons that
    # touch a zone's border line make the trace wander into a self-touching/notched shape,
    # and plain point-in-polygon then reports the zone's own label as "outside" (parity
    # cancels out). convexHull absorbs those notches -- it can only ever enclose more than
    # the raw contour, never less, so anything genuinely inside stays inside.
    candidates = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < noise_floor:
            continue
        x, y, cw, ch = cv2.boundingRect(contour)
        if is_title_block(x + cw / 2.0, y + ch / 2.0, img_w, img_h):
            continue
        candidates.append((cv2.convexHull(contour), area))

    label_for_candidate = {}
    used_label_ids = set()
    for idx, (hull, _area) in enumerate(candidates):
        for label in zone_name_labels:
            if label["id"] in used_label_ids:
                continue
            if cv2.pointPolygonTest(hull, (label["x"], label["y"]), False) >= 0:
                label_for_candidate[idx] = label
                used_label_ids.add(label["id"])
                break

    overlay = color.copy()
    zones = []
    zone_idx = 0
    for idx, (hull, area) in enumerate(candidates):
        perimeter = cv2.arcLength(hull, True)
        approx = cv2.approxPolyDP(hull, 0.01 * perimeter, True)
        points = [[int(p[0][0]), int(p[0][1])] for p in approx]
        if len(points) < 3:
            continue

        label = label_for_candidate.get(idx)
        if label is not None:
            name = label["text"]
        elif area >= fallback_min_area:
            zone_idx += 1
            name = f"Zone {zone_idx}"
        else:
            continue

        zones.append({
            "id": f"zone_{uuid.uuid4().hex[:8]}",
            "name": name,
            "points": points,
            "hidden": False,
        })
        cv2.drawContours(overlay, [approx], -1, (0, 0, 255), 3)

    cv2.imwrite(os.path.join(debug_dir, "zones_overlay.png"), overlay)

    for label in labels:
        if label["type"] == "zone":
            continue
        for zone in zones:
            if point_in_polygon(label["x"], label["y"], zone["points"]):
                label["associatedZone"] = zone["id"]
                break

    return zones


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf_path")
    parser.add_argument("output_dir")
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--cell-size-px", type=int, default=8)
    parser.add_argument("--kernel-size", type=int, default=5)
    args = parser.parse_args()

    debug_dir = os.path.join(args.output_dir, "debug")
    os.makedirs(debug_dir, exist_ok=True)
    raster_path = os.path.join(args.output_dir, "raster.png")

    try:
        emit("rasterizing")
        doc, page, scale, img_w, img_h = rasterize(args.pdf_path, args.dpi, raster_path)

        emit("building_grid")
        occupancy = build_occupancy_grid(raster_path, args.dpi, args.cell_size_px, args.kernel_size, debug_dir)
        with open(os.path.join(args.output_dir, "occupancy-grid.json"), "w", encoding="utf-8") as f:
            json.dump(occupancy, f)

        emit("extracting_labels")
        raw_word_count = len(page.get_text("words"))
        labels = extract_labels(page, scale, img_w, img_h)

        emit("detecting_zones")
        zones = detect_zones(raster_path, labels, img_w, img_h, debug_dir)

        with open(os.path.join(args.output_dir, "labels.json"), "w", encoding="utf-8") as f:
            json.dump(labels, f, indent=2)
        with open(os.path.join(args.output_dir, "zones.json"), "w", encoding="utf-8") as f:
            json.dump(zones, f, indent=2)

        type_counts = {}
        for label in labels:
            type_counts[label["type"]] = type_counts.get(label["type"], 0) + 1
        diagnostics = {
            "rawTextObjectCount": raw_word_count,
            "labelSpanCount": len(labels),
            "labelTypeCounts": type_counts,
            "zoneCount": len(zones),
        }
        with open(os.path.join(debug_dir, "diagnostics.json"), "w", encoding="utf-8") as f:
            json.dump(diagnostics, f, indent=2)

        doc.close()
        emit("done", sourcePixelWidth=img_w, sourcePixelHeight=img_h)
    except Exception as exc:  # noqa: BLE001
        emit("error", message=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
