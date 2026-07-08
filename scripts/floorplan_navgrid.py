"""Floorplan occupancy grid + pathfinding core.

Two concerns, kept in one module because they share the same on-disk cache:

1. Grid generation (image -> occupancy grid + connected-component regions +
   distance transform). Runs once per floor plan; result is cached to disk
   and never recomputed on a pathfinding query.
2. Pathfinding (A* over the cached grid, with Douglas-Peucker simplification
   of the resulting cell path).

CLI:
  python floorplan_navgrid.py grid <image_path> <cache_json_path> [--cell-size-px 8]
  python floorplan_navgrid.py route <cache_json_path> <start_x> <start_y> <end_x> <end_y>
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
import os
import re
import sys
import time
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
from scipy import ndimage

try:
    import pytesseract
except ImportError:
    pytesseract = None

# ---------------------------------------------------------------------------
# Grid generation
# ---------------------------------------------------------------------------

# Small islands of "walkable" pixels that survive morphology (noise, thin gaps
# under furniture) but aren't connected to the main navigable area get pruned
# back to wall rather than treated as reachable destinations.
MIN_REGION_FRACTION = 0.001  # relative to total walkable-cell count


def _odd(n: int) -> int:
    n = int(round(n))
    return n if n % 2 == 1 else n + 1


def adaptive_kernel_size(img_shape: tuple[int, int]) -> int:
    """Kernel scales with image resolution so thin walls survive on
    low-res scans and thick walls actually get closed on high-res ones."""
    h, w = img_shape
    diag = math.hypot(h, w)
    # ~1 px of kernel per 400px of diagonal, floor 3, cap 15 keeps runtime sane.
    size = diag / 400.0
    return max(3, min(15, _odd(size)))


def denoise(img: np.ndarray) -> np.ndarray:
    """Median blur knocks out salt-and-pepper scan noise; bilateral filter
    smooths flat regions while preserving wall edges (needed since the next
    step thresholds on edge sharpness)."""
    median = cv2.medianBlur(img, 3)
    return cv2.bilateralFilter(median, d=5, sigmaColor=50, sigmaSpace=50)


def binarize(img: np.ndarray) -> np.ndarray:
    """Otsu picks a global threshold from the image's own histogram instead of
    a fixed magic number, so it holds up across scans of varying exposure."""
    _, thresh = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return thresh


def build_occupancy_grid(image_path: str, cell_size_px: int = 8) -> dict:
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError(f"could not read image: {image_path}")
    h, w = img.shape

    denoised = denoise(img)
    thresh = binarize(denoised)

    kernel_size = adaptive_kernel_size((h, w))
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, kernel)

    grid_w = max(1, w // cell_size_px)
    grid_h = max(1, h // cell_size_px)
    resized = cv2.resize(opened, (grid_w, grid_h), interpolation=cv2.INTER_AREA)
    grid = (resized > 127).astype(np.uint8)  # 1 = wall, 0 = walkable

    walkable = (grid == 0).astype(np.uint8)

    # Flood-fill pruning: label connected walkable components once, drop any
    # component too small to be a real navigable area, then relabel densely
    # so downstream region-equality checks (same-component reachability) are
    # cheap array compares instead of repeated flood-fills per query.
    labels, num_labels = ndimage.label(walkable, structure=np.ones((3, 3)))
    if num_labels > 0:
        counts = np.bincount(labels.ravel())
        counts[0] = 0  # background/wall
        total_walkable = counts.sum()
        min_region_size = max(4, total_walkable * MIN_REGION_FRACTION)
        keep = counts >= min_region_size
        keep[0] = False
        pruned_mask = keep[labels]
        grid[walkable.astype(bool) & ~pruned_mask] = 1  # too-small islands become wall

        remap = np.zeros(num_labels + 1, dtype=np.int32)
        remap[keep] = np.arange(1, keep.sum() + 1)
        regions = remap[labels]
    else:
        regions = np.zeros_like(grid, dtype=np.int32)

    # Distance transform over the final walkable mask: distance (in cells) to
    # the nearest wall, used later as an A* cost bias so paths hug corridor
    # centers instead of grazing walls.
    final_walkable = (grid == 0).astype(np.uint8)
    distance_transform = cv2.distanceTransform(final_walkable, cv2.DIST_L2, 5)

    return {
        "width": grid_w,
        "height": grid_h,
        "cellSizePx": cell_size_px,
        "grid": grid.tolist(),
        "regions": regions.tolist(),
        "distanceTransform": distance_transform.tolist(),
    }


def _cache_key(image_path: str, cell_size_px: int) -> dict:
    stat = os.stat(image_path)
    return {"mtime": stat.st_mtime, "size": stat.st_size, "cellSizePx": cell_size_px}


def generate_and_cache_grid(image_path: str, cache_path: str, cell_size_px: int = 8) -> dict:
    """Returns the cached grid if the source image + params are unchanged;
    otherwise (re)builds it and writes the cache. Grid generation (morphology,
    threshold, flood-fill, distance transform) is the expensive part -- this
    is what makes it a build-once-per-floor-plan cost, not a per-query one."""
    key = _cache_key(image_path, cell_size_px)
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            cached = json.load(f)
        if cached.get("_cacheKey") == key:
            return cached

    grid = build_occupancy_grid(image_path, cell_size_px)
    grid["_cacheKey"] = key
    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(grid, f)
    return grid


# ---------------------------------------------------------------------------
# A* pathfinding
# ---------------------------------------------------------------------------

# (d_row, d_col, base_cost) -- diagonals cost sqrt2 like actual travel distance.
# Plain tuples, not a numpy array: this is iterated per node in the A* hot loop,
# and building/slicing a numpy array on every call costs more than it saves for
# a fixed 8-element list. Numpy is used instead where it actually pays off below
# (the one-time, whole-grid cost-multiplier precompute).
_NEIGHBOR_OFFSETS = (
    (-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
    (-1, -1, math.sqrt(2)), (-1, 1, math.sqrt(2)),
    (1, -1, math.sqrt(2)), (1, 1, math.sqrt(2)),
)

CORRIDOR_BIAS_WEIGHT = 0.75  # higher = paths pull harder toward corridor centers


def octile_distance(a: tuple[int, int], b: tuple[int, int]) -> float:
    dr = abs(a[0] - b[0])
    dc = abs(a[1] - b[1])
    return (dr + dc) + (math.sqrt(2) - 2) * min(dr, dc)


@dataclass
class GridData:
    grid: np.ndarray  # 1 = wall
    regions: np.ndarray
    cost_multiplier: np.ndarray
    height: int
    width: int

    @staticmethod
    def from_dict(d: dict) -> "GridData":
        grid = np.array(d["grid"], dtype=np.uint8)
        regions = np.array(d["regions"], dtype=np.int32)
        distance = np.array(d["distanceTransform"], dtype=np.float32)
        # Vectorized cost-lookup precompute: the distance-transform cost bias
        # (pulling paths toward corridor centers) is computed once over the
        # entire grid here, so the per-node A* loop does a single O(1) array
        # lookup per neighbor instead of recomputing the bias formula there.
        cost_multiplier = 1.0 + CORRIDOR_BIAS_WEIGHT / (distance + 1.0)
        return GridData(grid=grid, regions=regions, cost_multiplier=cost_multiplier, height=d["height"], width=d["width"])

    def walkable(self, row: int, col: int) -> bool:
        return 0 <= row < self.height and 0 <= col < self.width and self.grid[row, col] == 0

    def neighbors(self, row: int, col: int):
        for dr, dc, base_cost in _NEIGHBOR_OFFSETS:
            nr, nc = row + dr, col + dc
            if not self.walkable(nr, nc):
                continue
            if dr != 0 and dc != 0:
                # no cutting diagonally through a wall corner
                if not self.walkable(row + dr, col) or not self.walkable(row, col + dc):
                    continue
            yield (nr, nc), base_cost * float(self.cost_multiplier[nr, nc])


def astar(grid_data: GridData, start: tuple[int, int], goal: tuple[int, int]) -> Optional[list[tuple[int, int]]]:
    if not grid_data.walkable(*start) or not grid_data.walkable(*goal):
        return None
    # Flood-fill regions were computed once at grid-gen time; a same-region
    # check here is O(1) and skips searching when no path can possibly exist.
    if grid_data.regions[start] != grid_data.regions[goal] or grid_data.regions[start] == 0:
        return None

    g_score = {start: 0.0}
    came_from: dict[tuple[int, int], tuple[int, int]] = {}
    open_heap: list[tuple[float, int, tuple[int, int]]] = []
    counter = 0  # tie-breaker so heapq never compares tuples of cells
    heapq.heappush(open_heap, (octile_distance(start, goal), counter, start))
    closed: set[tuple[int, int]] = set()

    while open_heap:
        _, _, current = heapq.heappop(open_heap)
        if current == goal:
            path = [current]
            while current in came_from:
                current = came_from[current]
                path.append(current)
            path.reverse()
            return path
        if current in closed:
            continue
        closed.add(current)

        for neighbor, cost in grid_data.neighbors(*current):
            tentative_g = g_score[current] + cost
            if tentative_g < g_score.get(neighbor, math.inf):
                g_score[neighbor] = tentative_g
                came_from[neighbor] = current
                counter += 1
                f = tentative_g + octile_distance(neighbor, goal)
                heapq.heappush(open_heap, (f, counter, neighbor))

    return None


# ---------------------------------------------------------------------------
# Douglas-Peucker simplification
# ---------------------------------------------------------------------------

def _perpendicular_distance(point, line_start, line_end) -> float:
    x0, y0 = point
    x1, y1 = line_start
    x2, y2 = line_end
    if (x1, y1) == (x2, y2):
        return math.hypot(x0 - x1, y0 - y1)
    num = abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1)
    den = math.hypot(y2 - y1, x2 - x1)
    return num / den


def douglas_peucker(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points

    max_dist = 0.0
    index = 0
    for i in range(1, len(points) - 1):
        dist = _perpendicular_distance(points[i], points[0], points[-1])
        if dist > max_dist:
            max_dist = dist
            index = i

    if max_dist > epsilon:
        left = douglas_peucker(points[: index + 1], epsilon)
        right = douglas_peucker(points[index:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]


def simplify_cell_path(
    cells: list[tuple[int, int]], cell_size_px: int, epsilon_factor: float = 1.5
) -> list[tuple[float, float]]:
    """Epsilon scales with cell_size_px so simplification tolerance tracks
    grid resolution instead of a fixed pixel value that would over- or
    under-simplify depending on how coarse the grid is."""
    points = [((c + 0.5) * cell_size_px, (r + 0.5) * cell_size_px) for r, c in cells]
    epsilon = epsilon_factor * cell_size_px
    return douglas_peucker(points, epsilon)


SNAP_SEARCH_RADIUS_CELLS = 40  # generous enough to escape any furniture blob


def _nearest_walkable(grid_data: GridData, cell: tuple[int, int]) -> Optional[tuple[int, int]]:
    """POI/zone-centroid coordinates routinely land on a cell the occupancy grid
    marked occupied (furniture icons, a click a few px into a wall line). Spiral
    outward to the nearest actually-walkable cell rather than fail the query."""
    if grid_data.walkable(*cell):
        return cell
    row0, col0 = cell
    for radius in range(1, SNAP_SEARCH_RADIUS_CELLS + 1):
        for dr in range(-radius, radius + 1):
            for dc in range(-radius, radius + 1):
                if max(abs(dr), abs(dc)) != radius:
                    continue  # only the ring perimeter
                candidate = (row0 + dr, col0 + dc)
                if grid_data.walkable(*candidate):
                    return candidate
    return None


def find_path_px(
    grid_dict: dict, start_px: tuple[float, float], end_px: tuple[float, float]
) -> Optional[dict]:
    grid_data = GridData.from_dict(grid_dict)
    cell_size = grid_dict["cellSizePx"]

    def to_cell(px):
        col = min(grid_data.width - 1, max(0, int(px[0] // cell_size)))
        row = min(grid_data.height - 1, max(0, int(px[1] // cell_size)))
        return (row, col)

    start_cell = _nearest_walkable(grid_data, to_cell(start_px))
    end_cell = _nearest_walkable(grid_data, to_cell(end_px))
    if start_cell is None or end_cell is None:
        return None

    cell_path = astar(grid_data, start_cell, end_cell)
    if cell_path is None:
        return None

    simplified = simplify_cell_path(cell_path, cell_size)
    points = [list(start_px), *[list(p) for p in simplified], list(end_px)]
    distance_px = sum(
        math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
        for i in range(1, len(points))
    )
    return {"points": points, "distancePx": distance_px}


# ---------------------------------------------------------------------------
# Zone auto-detection
# ---------------------------------------------------------------------------

# A region occupying almost none of the walkable area is grid-gen noise (already
# mostly filtered there, this is a second, coarser pass); one occupying most of it
# is very likely the main corridor/open floor connecting everything, not a distinct
# room -- connected-components can't tell "room" from "hallway" apart on its own.
ZONE_MIN_AREA_FRACTION = 0.002
ZONE_MAX_AREA_FRACTION = 0.35

_WORKSTATION_RE = re.compile(r'\b(WORKSTATION|WS)[\s\-_]?([A-I])\b')
_CATEGORY_KEYWORDS = (
    (re.compile(r'\bODC\b'), 'ODC'),
    (re.compile(r'\bMEETING\b'), 'Meeting Room'),
    (re.compile(r'\bCABIN\b'), 'Cabin'),
    (re.compile(r'\bCAFE(TERIA)?\b'), 'Cafeteria'),
    (re.compile(r'\b(LIFT|ELEVATOR)\b'), 'Lift Lobby'),
)


def _guess_category(text: str) -> str:
    """Keyword-matches OCR text to a known zone category. Never invents a category
    it isn't confident about -- anything that doesn't match falls back to 'Other'
    rather than guessing wrong silently."""
    upper = text.upper()
    ws_match = _WORKSTATION_RE.search(upper)
    if ws_match:
        return f'Workstation {ws_match.group(2)}'
    for pattern, category in _CATEGORY_KEYWORDS:
        if pattern.search(upper):
            return category
    return 'Other'


def _ocr_region(gray_img: np.ndarray, bbox: tuple[float, float, float, float], padding: int = 6) -> Optional[str]:
    h, w = gray_img.shape
    x0 = max(0, int(bbox[0]) - padding)
    y0 = max(0, int(bbox[1]) - padding)
    x1 = min(w, int(bbox[2]) + padding)
    y1 = min(h, int(bbox[3]) + padding)
    if x1 <= x0 or y1 <= y0:
        return None
    crop = gray_img[y0:y1, x0:x1]
    if crop.size == 0:
        return None
    try:
        text = pytesseract.image_to_string(crop)
    except Exception:
        return None
    for line in text.splitlines():
        cleaned = line.strip()
        if cleaned:
            return cleaned
    return None


def simplify_polygon(
    points: list[tuple[float, float]], cell_size_px: int, epsilon_factor: float = 1.5
) -> list[tuple[float, float]]:
    """Closed-contour analog of simplify_cell_path. douglas_peucker() assumes an
    open polyline anchored at its two endpoints, so a closed loop is split at its
    two most distant points into two open chains, each simplified with the exact
    same function and epsilon scaling, then merged -- reuses the existing DP
    logic rather than a separate closed-curve implementation."""
    if len(points) < 4:
        return points
    epsilon = epsilon_factor * cell_size_px
    anchor = points[0]
    far_idx = max(
        range(1, len(points)),
        key=lambda i: math.hypot(points[i][0] - anchor[0], points[i][1] - anchor[1]),
    )
    chain_a = points[: far_idx + 1]
    chain_b = points[far_idx:] + [points[0]]
    simplified_a = douglas_peucker(chain_a, epsilon)
    simplified_b = douglas_peucker(chain_b, epsilon)
    return simplified_a[:-1] + simplified_b[:-1]


def detect_zones(grid_dict: dict, source_image_path: str) -> dict:
    """Finds enclosed walkable regions in the already-generated occupancy grid
    (reusing the connected-component labels computed once at grid-gen time),
    turns each into a simplified polygon, and OCRs its bounding box for a name/
    category guess. Returns candidates only -- nothing here writes to any config;
    the caller (Setup Mode UI) presents them as editable, unconfirmed entries."""
    regions = np.array(grid_dict['regions'], dtype=np.int32)
    grid = np.array(grid_dict['grid'], dtype=np.uint8)
    cell_size = grid_dict['cellSizePx']
    total_walkable = int((grid == 0).sum())

    ocr_available = pytesseract is not None
    if ocr_available:
        try:
            pytesseract.get_tesseract_version()
        except Exception:
            ocr_available = False

    source_img = cv2.imread(source_image_path, cv2.IMREAD_GRAYSCALE) if ocr_available else None
    if source_img is None:
        ocr_available = False

    zones = []
    if total_walkable > 0:
        for label in (l for l in np.unique(regions) if l != 0):
            region_mask = regions == label
            area_fraction = int(region_mask.sum()) / total_walkable
            if area_fraction < ZONE_MIN_AREA_FRACTION or area_fraction > ZONE_MAX_AREA_FRACTION:
                continue

            mask_u8 = (region_mask.astype(np.uint8)) * 255
            contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                continue
            contour = max(contours, key=cv2.contourArea)
            if len(contour) < 3:
                continue

            px_points = [((float(p[0][0]) + 0.5) * cell_size, (float(p[0][1]) + 0.5) * cell_size) for p in contour]
            simplified = simplify_polygon(px_points, cell_size)
            if len(simplified) < 3:
                continue

            xs = [p[0] for p in px_points]
            ys = [p[1] for p in px_points]
            bbox = (min(xs), min(ys), max(xs), max(ys))
            centroid = (
                sum(p[0] for p in simplified) / len(simplified),
                sum(p[1] for p in simplified) / len(simplified),
            )

            ocr_text = _ocr_region(source_img, bbox) if ocr_available else None
            category = _guess_category(ocr_text) if ocr_text else 'Other'
            name = ocr_text if ocr_text else f'Zone {int(label)}'

            zones.append({
                'points': [{'x': p[0], 'y': p[1]} for p in simplified],
                'name': name,
                'category': category,
                'ocrText': ocr_text,
                'centroid': {'x': centroid[0], 'y': centroid[1]},
            })

    return {'ocrAvailable': ocr_available, 'zones': zones}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    grid_cmd = sub.add_parser("grid", help="build (or load cached) occupancy grid from an image")
    grid_cmd.add_argument("image_path")
    grid_cmd.add_argument("cache_path")
    grid_cmd.add_argument("--cell-size-px", type=int, default=8)

    route_cmd = sub.add_parser("route", help="run A* between two pixel points against a cached grid")
    route_cmd.add_argument("cache_path")
    route_cmd.add_argument("start_x", type=float)
    route_cmd.add_argument("start_y", type=float)
    route_cmd.add_argument("end_x", type=float)
    route_cmd.add_argument("end_y", type=float)

    detect_cmd = sub.add_parser("detect", help="auto-detect zone polygons + OCR labels from a cached grid")
    detect_cmd.add_argument("cache_path")
    detect_cmd.add_argument("source_image_path")

    args = parser.parse_args()

    if args.command == "grid":
        t0 = time.perf_counter()
        grid = generate_and_cache_grid(args.image_path, args.cache_path, args.cell_size_px)
        elapsed = time.perf_counter() - t0
        print(json.dumps({"stage": "done", "elapsedSec": elapsed, "width": grid["width"], "height": grid["height"]}))
    elif args.command == "route":
        with open(args.cache_path, "r", encoding="utf-8") as f:
            grid_dict = json.load(f)
        result = find_path_px(grid_dict, (args.start_x, args.start_y), (args.end_x, args.end_y))
        if result is None:
            print(json.dumps({"error": "no path found"}))
            sys.exit(1)
        print(json.dumps(result))
    elif args.command == "detect":
        with open(args.cache_path, "r", encoding="utf-8") as f:
            grid_dict = json.load(f)
        print(json.dumps(detect_zones(grid_dict, args.source_image_path)))


if __name__ == "__main__":
    main()
