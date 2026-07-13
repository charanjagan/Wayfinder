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
  python floorplan_navgrid.py extract <pdf_path> <cache_json_path> [--dpi 200]
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
import os
import re
import time
from collections import Counter
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
import pdfplumber
from scipy import ndimage

# ---------------------------------------------------------------------------
# Grid generation
# ---------------------------------------------------------------------------

# Small islands of "walkable" pixels that survive morphology (noise, thin gaps
# under furniture) but aren't connected to the main navigable area get pruned
# back to wall rather than treated as reachable destinations.
MIN_REGION_FRACTION = 0.001  # relative to total walkable-cell count

# Absolute pixel count, not resolution-relative: a scan-noise speck is a
# handful of pixels regardless of image size, while even the thinnest real
# wall spans many pixels along its length -- see build_occupancy_grid.
MIN_WALL_COMPONENT_PX = 8

# Out of 255 (see build_occupancy_grid): a grid cell needs at least ~16% wall-
# pixel coverage to count as a wall, not >50%. Empirically, a real 2px-thick
# partition wall inside an 8px grid cell measured at ~25% coverage; this sits
# comfortably below that with margin above pure antialiasing/compression noise.
WALL_CELL_COVERAGE_THRESHOLD = 40


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


# How far below the bright background level still counts as ink/wall. A vector-
# exported CAD plan draws interior partition walls in a light grey (~173) while
# the page background is pure white (255); Otsu, assuming a bimodal histogram,
# puts its threshold between the background and only the DARKEST ink, so that
# mid-grey linework lands on the background side and vanishes. Thresholding a
# fixed margin below the detected background peak instead keeps ALL ink -- black
# exterior walls and grey interior walls alike -- while excluding only the near-
# white antialiasing halo around each line.
BACKGROUND_INK_MARGIN = 35


def binarize(img: np.ndarray) -> np.ndarray:
    """Separates ink (any linework -- walls, furniture, text) from the bright
    page background. See BACKGROUND_INK_MARGIN for why this replaced Otsu:
    Otsu dropped the light-grey interior partition walls entirely, leaving only
    the solid-black exterior boundary, so interior rooms never got wall barriers."""
    hist = cv2.calcHist([img], [0], None, [256], [0, 256]).ravel()
    # Background = the dominant level in the bright end of the histogram.
    background = int(np.argmax(hist[180:])) + 180
    thresh_val = max(1, background - BACKGROUND_INK_MARGIN)
    _, thresh = cv2.threshold(img, thresh_val, 255, cv2.THRESH_BINARY_INV)
    return thresh


# Walls and furniture are both drawn in the same grey ink, so intensity can't
# tell them apart. Geometry can: a wall is a THIN (1-5px) LONG (spans a room)
# straight line, while a desk/chair is a THICK filled block or a short/diagonal
# run. The routing grid must contain walls but NOT furniture -- otherwise every
# desk is an obstacle and the open office becomes a maze of detours. These two
# constants encode "long" and "thick" in source-image pixels; both scale with
# the image so they hold across DPIs.
WALL_MIN_LINE_FRACTION = 1 / 40.0   # min straight-run length, as a fraction of image diagonal
FURNITURE_MIN_THICKNESS_FRACTION = 1 / 450.0  # blobs thicker than this are furniture, not walls
_BLACK_INK_MAX = 60  # solid-black structural/exterior linework, always kept as wall


def extract_walls(gray_img: np.ndarray) -> np.ndarray:
    """Builds a walls-only mask (255 = wall) from a floor-plan image, excluding
    furniture. Furniture (desks/chairs) shares the walls' grey ink but differs
    geometrically, so it's separated by shape, not colour:

      * KEEP solid-black linework outright -- exterior/structural walls, and the
        only reliable signal for diagonal boundaries (which line-length filters
        below would miss).
      * KEEP long straight horizontal/vertical runs of ink -- interior partition
        walls. A morphological opening with a long 1-D kernel passes a run only
        if it is at least that long, dropping short desk edges and the diagonal
        desk rows (which aren't axis-aligned) entirely.
      * Then DROP anything thick -- a solid square opening survives only on filled
        blocks wider than a wall line, i.e. desks; subtracting it removes the
        axis-aligned desk rows that were long enough to sneak through the line
        filter, while the thin wall lines (which the opening erases) are unharmed.
    """
    h, w = gray_img.shape
    diag = math.hypot(h, w)
    line_len = max(20, int(diag * WALL_MIN_LINE_FRACTION))
    thickness = max(5, int(diag * FURNITURE_MIN_THICKNESS_FRACTION) | 1)

    ink = binarize(gray_img)
    black = ((gray_img < _BLACK_INK_MAX).astype(np.uint8)) * 255

    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (line_len, 1))
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, line_len))
    long_lines = cv2.bitwise_or(
        cv2.morphologyEx(ink, cv2.MORPH_OPEN, h_kernel),
        cv2.morphologyEx(ink, cv2.MORPH_OPEN, v_kernel),
    )
    walls = cv2.bitwise_or(long_lines, black)

    thick_furniture = cv2.morphologyEx(ink, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (thickness, thickness)))
    thick_furniture = cv2.dilate(thick_furniture, np.ones((5, 5), np.uint8))
    # Black structural ink is trusted even where it overlaps a thick region (a
    # solid-black column shouldn't be erased as "furniture").
    walls = cv2.bitwise_or(cv2.bitwise_and(walls, cv2.bitwise_not(thick_furniture)), black)
    return cv2.dilate(walls, np.ones((3, 3), np.uint8))


def _label_walkable_regions(walkable: np.ndarray) -> tuple[np.ndarray, int]:
    """Labels connected walkable components using the EXACT adjacency A* travels
    with: 4 orthogonal moves plus diagonals, where a diagonal is allowed only if
    at least one of its two shared orthogonal neighbours is also walkable (never
    cut straight through a solid inside corner). Using ndimage's plain
    8-connectivity here instead would mark two cells "same region" when they only
    touch through a pure diagonal pinch that A* refuses to cross -- so a routing
    query between them returns "no path" despite the region check passing. This
    makes region-equality mean exactly "A* can travel between them"."""
    h, w = walkable.shape
    labels = np.zeros((h, w), dtype=np.int32)
    current = 0
    orth = ((-1, 0), (1, 0), (0, -1), (0, 1))
    diag = ((-1, -1), (-1, 1), (1, -1), (1, 1))
    stack: list[tuple[int, int]] = []
    for sr in range(h):
        for sc in range(w):
            if not walkable[sr, sc] or labels[sr, sc]:
                continue
            current += 1
            labels[sr, sc] = current
            stack.append((sr, sc))
            while stack:
                r, c = stack.pop()
                for dr, dc in orth:
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < h and 0 <= nc < w and walkable[nr, nc] and not labels[nr, nc]:
                        labels[nr, nc] = current
                        stack.append((nr, nc))
                for dr, dc in diag:
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < h and 0 <= nc < w and walkable[nr, nc] and not labels[nr, nc]:
                        if walkable[r + dr, c] or walkable[r, c + dc]:  # not a solid corner
                            labels[nr, nc] = current
                            stack.append((nr, nc))
    return labels, current


def build_occupancy_grid(image_path: str, cell_size_px: int = 8) -> dict:
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError(f"could not read image: {image_path}")
    h, w = img.shape

    denoised = denoise(img)

    # Walls only, furniture excluded -- see extract_walls. A wayfinding grid must
    # treat desks as walk-around-able (route to them via aisles), not as hard
    # barriers, or the open office turns into a maze of detours.
    walls_mask = extract_walls(denoised)

    # CLOSE bridges small gaps in broken/dashed wall lines -- scales with
    # resolution like before.
    close_kernel_size = adaptive_kernel_size((h, w))
    closed = cv2.morphologyEx(walls_mask, cv2.MORPH_CLOSE, np.ones((close_kernel_size, close_kernel_size), np.uint8))

    # Drop stray specks: a scan-noise blob is a handful of pixels regardless of
    # shape, while even a hairline wall has many pixels along its length.
    wall_components, num_wall_components = ndimage.label(closed > 0, structure=np.ones((3, 3)))
    if num_wall_components > 0:
        wall_counts = np.bincount(wall_components.ravel())
        wall_counts[0] = 0
        keep_wall = wall_counts >= MIN_WALL_COMPONENT_PX
        keep_wall[0] = False
        opened = np.where(keep_wall[wall_components], 255, 0).astype(np.uint8)
    else:
        opened = closed

    grid_w = max(1, w // cell_size_px)
    grid_h = max(1, h // cell_size_px)
    # INTER_AREA gives each output cell the average wall-pixel coverage of the
    # source pixels it summarizes. A >127 (50%+ coverage) cutoff sounds like the
    # obvious "majority vote", but it silently drops any wall a cell_size_px-wide
    # cell doesn't mostly contain -- a 2px-thick wall inside an 8px cell is only
    # ~25% coverage and was vanishing here even though it survived every step
    # before this one. Wayfinding should err toward treating a real wall as
    # blocking rather than averaging it away, so the cutoff is deliberately low.
    resized = cv2.resize(opened, (grid_w, grid_h), interpolation=cv2.INTER_AREA)
    grid = (resized > WALL_CELL_COVERAGE_THRESHOLD).astype(np.uint8)  # 1 = wall, 0 = walkable

    walkable = (grid == 0).astype(np.uint8)

    # Flood-fill pruning: label connected walkable components once (using A*'s
    # own adjacency, so region-equality == A*-reachability -- see
    # _label_walkable_regions), drop any component too small to be a real
    # navigable area, then relabel densely so downstream region-equality checks
    # are cheap array compares instead of repeated flood-fills per query.
    labels, num_labels = _label_walkable_regions(walkable.astype(bool))
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
                # Allow squeezing past a single wall corner (a doorway diagonal),
                # but never cut straight through a solid inside corner where BOTH
                # shared orthogonal neighbours are walls. Must stay identical to
                # the rule in _label_walkable_regions so region-equality keeps
                # meaning "A* can travel between them".
                if not self.walkable(row + dr, col) and not self.walkable(row, col + dc):
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


def _supercover_cells(r0: int, c0: int, r1: int, c1: int) -> list[tuple[int, int]]:
    """Every grid cell the straight segment between two cell centers passes
    through (a "supercover" line, not a thin Bresenham line). At an exact
    diagonal crossing it conservatively includes BOTH corner-adjacent cells, so
    a segment can never be judged clear when it actually clips the corner of a
    wall -- the same no-corner-cutting rule A* itself uses on diagonal moves."""
    cells = [(r0, c0)]
    dr, dc = abs(r1 - r0), abs(c1 - c0)
    sr = 1 if r1 > r0 else -1
    sc = 1 if c1 > c0 else -1
    r, c = r0, c0
    ir = ic = 0
    while ir < dr or ic < dc:
        decision = (1 + 2 * ir) * dc - (1 + 2 * ic) * dr
        if decision == 0:
            cells.append((r + sr, c))
            cells.append((r, c + sc))
            r += sr
            c += sc
            ir += 1
            ic += 1
        elif decision < 0:
            r += sr
            ir += 1
        else:
            c += sc
            ic += 1
        cells.append((r, c))
    return cells


def _cell_line_of_sight(grid_data: GridData, a: tuple[int, int], b: tuple[int, int]) -> bool:
    """True iff the straight line between cell centers a and b stays entirely on
    walkable cells -- used to guarantee a simplified route segment never cuts
    through a wall."""
    return all(grid_data.walkable(r, c) for r, c in _supercover_cells(a[0], a[1], b[0], b[1]))


def simplify_cell_path(
    cells: list[tuple[int, int]], cell_size_px: int, grid_data: GridData
) -> list[tuple[float, float]]:
    """Line-of-sight ("string pulling") simplification: greedily keep the fewest
    waypoints such that every consecutive pair still has a clear straight,
    wall-free line between them. Unlike blind Douglas-Peucker -- which only
    bounds perpendicular deviation from the cell path and so happily straightens
    a corner into a segment that clips the wall on the inside of the turn -- this
    can never emit a segment that crosses a wall, because each retained segment
    is LOS-verified against the occupancy grid."""
    if len(cells) <= 2:
        return [((c + 0.5) * cell_size_px, (r + 0.5) * cell_size_px) for r, c in cells]

    kept = [cells[0]]
    anchor = 0
    for i in range(2, len(cells)):
        if not _cell_line_of_sight(grid_data, cells[anchor], cells[i]):
            # cells[i-1] is the farthest cell still visible from the anchor;
            # commit it and start a fresh segment from there.
            kept.append(cells[i - 1])
            anchor = i - 1
    kept.append(cells[-1])
    return [((c + 0.5) * cell_size_px, (r + 0.5) * cell_size_px) for r, c in kept]


SNAP_SEARCH_RADIUS_CELLS = 40  # generous enough to escape any furniture blob


def _nearest_walkable(
    grid_data: GridData, cell: tuple[int, int], region: Optional[int] = None, max_radius: int = SNAP_SEARCH_RADIUS_CELLS
) -> Optional[tuple[int, int]]:
    """POI/zone-centroid coordinates routinely land on a cell the occupancy grid
    marked occupied (furniture icons, a click a few px into a wall line). Spiral
    outward to the nearest actually-walkable cell rather than fail the query. When
    `region` is given, only cells in that connected region qualify -- used to snap
    a destination out to the nearest cell actually reachable from the origin (a
    desk POI boxed in by its own furniture snaps to the adjacent corridor, not a
    dead one-cell pocket between desks)."""
    def ok(r: int, c: int) -> bool:
        if not grid_data.walkable(r, c):
            return False
        return region is None or grid_data.regions[r, c] == region

    if ok(*cell):
        return cell
    row0, col0 = cell
    for radius in range(1, max_radius + 1):
        for dr in range(-radius, radius + 1):
            for dc in range(-radius, radius + 1):
                if max(abs(dr), abs(dc)) != radius:
                    continue  # only the ring perimeter
                candidate = (row0 + dr, col0 + dc)
                if 0 <= candidate[0] < grid_data.height and 0 <= candidate[1] < grid_data.width and ok(*candidate):
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

    # If the endpoints snapped into different connected regions, the destination
    # likely landed in a tiny furniture pocket rather than the reachable floor.
    # Re-snap it (searching a wider radius) to the nearest cell in the origin's
    # region, so a boxed-in desk POI routes to the adjacent corridor instead of
    # failing outright. Same reachability guarantee holds either way.
    if grid_data.regions[start_cell] != grid_data.regions[end_cell]:
        start_region = int(grid_data.regions[start_cell])
        resnapped = _nearest_walkable(grid_data, to_cell(end_px), region=start_region, max_radius=80)
        if resnapped is not None:
            end_cell = resnapped

    cell_path = astar(grid_data, start_cell, end_cell)
    if cell_path is None:
        return None

    simplified = simplify_cell_path(cell_path, cell_size, grid_data)
    # The raw click/POI pixel is only reconnected to the walkable path when a
    # clear straight line reaches it; otherwise it sat inside a wall/furniture
    # blob (POI drawn on a desk icon, a click into a wall) and drawing a line
    # to it would visibly spear through the wall. In that case the route just
    # starts/ends at the snapped walkable waypoint instead.
    start_ok = _cell_line_of_sight(grid_data, start_cell, to_cell(start_px))
    end_ok = _cell_line_of_sight(grid_data, end_cell, to_cell(end_px))
    points = [
        *([list(start_px)] if start_ok else []),
        *[list(p) for p in simplified],
        *([list(end_px)] if end_ok else []),
    ]
    distance_px = sum(
        math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
        for i in range(1, len(points))
    )
    return {"points": points, "distancePx": distance_px}


# ---------------------------------------------------------------------------
# Zone auto-detection
# ---------------------------------------------------------------------------

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


def _region_contour_polygon(regions: np.ndarray, label: int, cell_size: int) -> Optional[list[tuple[float, float]]]:
    """Traces the outer contour of one connected-component region and simplifies
    it -- shared by both room zones and prefix (workstation-zone) polygons, since
    both are ultimately "the drawable shape of this region"."""
    mask_u8 = ((regions == label).astype(np.uint8)) * 255
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    if len(contour) < 3:
        return None
    px_points = [((float(p[0][0]) + 0.5) * cell_size, (float(p[0][1]) + 0.5) * cell_size) for p in contour]
    simplified = simplify_polygon(px_points, cell_size)
    return simplified if len(simplified) >= 3 else None


# ---------------------------------------------------------------------------
# Text-layer label extraction (pdfplumber)
# ---------------------------------------------------------------------------

# The naming convention is [ZONE PREFIX]-[TYPE]-[NUM]-[ID], e.g. ZA-WS-31-031,
# ODC-WS-05-441, CO1-WS-01-468. Hyphens in the source PDF are frequently a
# soft-hyphen (U+00AD) rather than ASCII '-', normalized before matching.
_HYPHEN_VARIANTS_RE = re.compile(r'[­‐‑‒–—−]')
WS_PC_RE = re.compile(r'^([A-Z0-9]{2,4})-(WS|PC)-(\d+)-(\d+)$')

# Prefix -> zone category. ZA..ZI map onto the existing "Workstation X" categories;
# the remaining known prefixes get their own dedicated categories (see lib/types.ts).
_PREFIX_LETTER_RE = re.compile(r'^Z([A-I])$')


def _prefix_category(prefix: str) -> str:
    m = _PREFIX_LETTER_RE.match(prefix)
    if m:
        return f'Workstation {m.group(1)}'
    if prefix in ('ODC', 'CO1', 'CO2', 'CO3', 'INFA'):
        return prefix
    return 'Other'


_ROOM_CATEGORY_KEYWORDS = (
    (re.compile(r'\bODC\b'), 'ODC'),
    (re.compile(r'\bMEETING\b'), 'Meeting Room'),
    (re.compile(r'\bBOARD\s*ROOM\b'), 'Board Room'),
    (re.compile(r'\bCABIN\b'), 'Cabin'),
    (re.compile(r'\bCAFE(TERIA)?\b'), 'Cafeteria'),
    (re.compile(r'\b(LIFT|ELEVATOR)\s*LOBBY\b'), 'Lift Lobby'),
    (re.compile(r'\bPANTRY\b'), 'Pantry'),
    (re.compile(r'\bSERVER\s*ROOM\b'), 'Server Room'),
    (re.compile(r'\b(TOILET|REST\s*ROOM|WASH\s*ROOM|G\.?TOI|L\.?TOI)\b'), 'Toilet'),
    (re.compile(r'\bHUDDLE\b'), 'Huddle Room'),
    (re.compile(r'\bPHONE\s*BOOTH\b'), 'Phone Booth'),
    (re.compile(r'\bPRAYER\s*ROOM\b'), 'Prayer Room'),
    (re.compile(r'\b(COLLAB|COLLABORATIVE)\b'), 'Collab Room'),
    (re.compile(r'\bTRAINING\s*ROOM\b'), 'Training Room'),
    (re.compile(r'\bSTORE|STORAGE\b'), 'Store Room'),
)


def _room_category(text: str) -> str:
    """Keyword-matches an extracted room label to a known zone category. Never
    invents a category it isn't confident about -- anything that doesn't match
    falls back to 'Other' rather than guessing wrong silently."""
    upper = text.upper()
    for pattern, category in _ROOM_CATEGORY_KEYWORDS:
        if pattern.search(upper):
            return category
    return 'Other'


def _cluster_words(words: list[dict], h_gap: float = 3.0, v_gap: float = 2.5) -> list[list[dict]]:
    """Groups nearby pdfplumber words into label blocks: words on the same line
    within h_gap of each other, or stacked within v_gap with overlapping x-range
    (covers multi-line labels like "MEETING ROOM" / "4 PAX 06" stacked directly
    below it). Union-find over all pairs -- floor-plan label blocks are small
    (a handful of words), so the O(n^2) pair scan is cheap relative to grid-gen."""
    parent = list(range(len(words)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for i in range(len(words)):
        a = words[i]
        for j in range(i + 1, len(words)):
            b = words[j]
            y_overlap = min(a['bottom'], b['bottom']) - max(a['top'], b['top'])
            min_h = min(a['bottom'] - a['top'], b['bottom'] - b['top'])
            if y_overlap > 0.5 * min_h:
                gap = max(a['x0'], b['x0']) - min(a['x1'], b['x1'])
                if gap < h_gap:
                    union(i, j)
                    continue
            x_overlap = min(a['x1'], b['x1']) - max(a['x0'], b['x0'])
            min_w = min(a['x1'] - a['x0'], b['x1'] - b['x0'])
            if x_overlap > 0.3 * min_w:
                vgap = max(a['top'], b['top']) - min(a['bottom'], b['bottom'])
                if 0 <= vgap < v_gap:
                    union(i, j)

    clusters: dict[int, list[dict]] = {}
    for i, w in enumerate(words):
        clusters.setdefault(find(i), []).append(w)
    return list(clusters.values())


_REAL_WORD_RE = re.compile(r'^[A-Z]{3,}$')

# A region covering more than this fraction of all walkable cells is clearly the
# shared open floor/corridor, not a single room -- on an open-plan floor, rooms
# with no wall on one side (a 3-walled meeting pod open to the walkway, say) are
# pathfinding-connected to that whole shared area even though they're visually
# just a small fraction of it. Room labels landing in a region this large get
# their own footprint ray-cast from the label point instead of inheriting the
# entire connected region as their "zone".
DOMINANT_REGION_AREA_FRACTION = 0.08

RAYCAST_OFFSET_CELLS = 3  # spacing between parallel rays per direction
RAYCAST_NUM_OFFSETS = 2  # offsets on each side of center -> 5 rays per direction


def _raycast_room_box(grid: np.ndarray, row0: int, col0: int, max_cells: int) -> tuple[int, int, int, int]:
    """From a room label's grid cell, finds the room's footprint by casting
    several parallel rays in each of the 4 cardinal directions and taking the
    farthest wall hit among them (robust to a single desk/chair icon -- drawn
    with wall-dark linework -- blocking any one ray) and capping at max_cells
    for directions with no wall at all (the open side of the room). Returns
    (top, left, bottom, right) in grid-cell coordinates."""
    h, w = grid.shape

    def cast(dr: int, dc: int, perp_dr: int, perp_dc: int) -> int:
        best = 0
        for offset in range(-RAYCAST_NUM_OFFSETS, RAYCAST_NUM_OFFSETS + 1):
            r0, c0 = row0 + offset * RAYCAST_OFFSET_CELLS * perp_dr, col0 + offset * RAYCAST_OFFSET_CELLS * perp_dc
            if not (0 <= r0 < h and 0 <= c0 < w) or grid[r0, c0] != 0:
                continue
            dist, r, c = 0, r0, c0
            while dist < max_cells:
                nr, nc = r + dr, c + dc
                if not (0 <= nr < h and 0 <= nc < w) or grid[nr, nc] != 0:
                    break
                r, c, dist = nr, nc, dist + 1
            best = max(best, dist)
        return best

    up = cast(-1, 0, 0, 1)
    down = cast(1, 0, 0, 1)
    left = cast(0, -1, 1, 0)
    right = cast(0, 1, 1, 0)
    return row0 - up, col0 - left, row0 + down, col0 + right


LABEL_SNAP_RADIUS_CELLS = 5  # a label's own anchor point (word-bbox centroid)
# routinely lands a pixel or two into a wall stroke -- especially now that wall
# detection is more sensitive (see WALL_CELL_COVERAGE_THRESHOLD) -- so region
# lookups snap to the nearest walkable cell within a small radius first, same
# idea as the pathfinder's own nearest-walkable snap for start/end points.


def _nearest_walkable_cell(grid: np.ndarray, row0: int, col0: int, radius: int) -> Optional[tuple[int, int]]:
    h, w = grid.shape
    if 0 <= row0 < h and 0 <= col0 < w and grid[row0, col0] == 0:
        return row0, col0
    for r in range(1, radius + 1):
        for dr in range(-r, r + 1):
            for dc in range(-r, r + 1):
                if max(abs(dr), abs(dc)) != r:
                    continue
                nr, nc = row0 + dr, col0 + dc
                if 0 <= nr < h and 0 <= nc < w and grid[nr, nc] == 0:
                    return nr, nc
    return None


def _raycast_room_polygon(grid: np.ndarray, row0: int, col0: int, cell_size: int, max_cells: int) -> list[tuple[float, float]]:
    top, left, bottom, right = _raycast_room_box(grid, row0, col0, max_cells)
    x0, y0 = left * cell_size, top * cell_size
    x1, y1 = (right + 1) * cell_size, (bottom + 1) * cell_size
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def extract_labels(pdf_path: str, grid_dict: dict, dpi: int) -> dict:
    """Extracts every text label from the PDF's native text layer (no OCR --
    this is a real, embedded text layer) and turns it into either a WS/PC POI
    (via the naming-convention regex) or a room zone (via connected-region
    containment against the already-generated occupancy grid). Returns
    candidates only -- nothing here writes to any config; the caller (Setup
    Mode UI) presents them as editable, unconfirmed entries, exactly like the
    OCR-based detector it replaces."""
    regions = np.array(grid_dict['regions'], dtype=np.int32)
    grid = np.array(grid_dict['grid'], dtype=np.uint8)
    cell_size = grid_dict['cellSizePx']
    grid_h, grid_w = regions.shape
    px_per_pt = dpi / 72.0

    region_cell_counts = Counter(regions[regions != 0].tolist())
    total_walkable_cells = sum(region_cell_counts.values())
    raycast_max_cells = int(0.15 * min(grid_h, grid_w))

    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[0]
        raw_words = page.extract_words(use_text_flow=False, keep_blank_chars=False)

    # Rotated/vertical annotations (e.g. corridor-width callouts running along a
    # hallway) aren't room or POI labels and pdfplumber can't word-join them
    # sanely anyway -- excluded up front rather than fed into clustering.
    words = [w for w in raw_words if w.get('upright', True) and w.get('direction') == 'ltr']

    def to_px(x_pt: float, y_pt: float) -> tuple[float, float]:
        return x_pt * px_per_pt, y_pt * px_per_pt

    def label_cell(x_px: float, y_px: float) -> Optional[tuple[int, int]]:
        col = int(x_px // cell_size)
        row = int(y_px // cell_size)
        if not (0 <= row < grid_h and 0 <= col < grid_w):
            return None
        return _nearest_walkable_cell(grid, row, col, LABEL_SNAP_RADIUS_CELLS)

    def region_at(x_px: float, y_px: float) -> int:
        cell = label_cell(x_px, y_px)
        return int(regions[cell]) if cell else 0

    total_labels_extracted = len(words)

    # --- WS/PC POIs: only clean, single-token matches are trusted. Some labels
    # on this drawing are rendered as one glyph per text run (an exploded/legend
    # layer duplicating the same codes) and reconstructing those via clustering
    # produced scrambled or cross-contaminated strings in testing -- unreliable
    # enough that skipping them is safer than fabricating a wrong POI.
    pois = []
    poi_word_ids = set()
    for i, w in enumerate(words):
        text = _HYPHEN_VARIANTS_RE.sub('-', w['text'])
        m = WS_PC_RE.match(text)
        if not m:
            continue
        poi_word_ids.add(i)
        cx_pt, cy_pt = (w['x0'] + w['x1']) / 2, (w['top'] + w['bottom']) / 2
        x_px, y_px = to_px(cx_pt, cy_pt)
        pois.append({
            'label': text,
            'prefix': m.group(1),
            'type': m.group(2),
            'x': x_px,
            'y': y_px,
        })

    duplicate_labels: dict[str, int] = {}
    for label, count in Counter(p['label'] for p in pois).items():
        if count > 1:
            duplicate_labels[label] = count

    # --- Room/space labels: cluster the remaining words into label blocks, drop
    # any block whose reconstructed text is itself a WS/PC fragment (exploded-
    # label noise, see above) or that contains no real word, then map each
    # surviving block to the connected region containing its centroid.
    room_candidate_words = [w for i, w in enumerate(words) if i not in poi_word_ids]
    clusters = _cluster_words(room_candidate_words)

    room_labels = []
    for members in clusters:
        members_sorted = sorted(members, key=lambda w: (round(w['top'], 0), w['x0']))
        spaced_text = ' '.join(w['text'] for w in members_sorted)
        tight_text = _HYPHEN_VARIANTS_RE.sub('-', ''.join(w['text'] for w in members_sorted).replace(' ', ''))
        if WS_PC_RE.search(tight_text):
            continue
        if not any(_REAL_WORD_RE.match(w['text']) for w in members):
            continue

        x0 = min(w['x0'] for w in members)
        x1 = max(w['x1'] for w in members)
        top = min(w['top'] for w in members)
        bottom = max(w['bottom'] for w in members)
        cx_px, cy_px = to_px((x0 + x1) / 2, (top + bottom) / 2)
        room_labels.append({'text': spaced_text, 'x': cx_px, 'y': cy_px})

    # Group room labels by which connected region their point falls in. A "ZONE
    # <letter>" label sitting inside a region is ground truth for the workstation
    # zone -> region mapping (more reliable than inferring it from where that
    # prefix's own POIs happen to cluster, since POIs can be scattered across a
    # wide open-plan area). Everything else becomes a room zone from its own
    # region's contour.
    _ZONE_LETTER_RE = re.compile(r'^ZONE\s+([A-I])$')
    labels_by_region: dict[int, list[dict]] = {}
    orphaned_labels = []
    prefix_zone_region: dict[str, int] = {}

    for label in room_labels:
        region_id = region_at(label['x'], label['y'])
        if region_id == 0:
            orphaned_labels.append({'text': label['text'], 'x': label['x'], 'y': label['y']})
            continue
        m = _ZONE_LETTER_RE.match(label['text'].upper())
        if m:
            # A "ZONE <letter>" marker is purely structural -- it feeds the
            # prefix-zone builder below, not a room zone of its own (it would
            # otherwise duplicate the prefix zone it's naming).
            prefix_zone_region[f'Z{m.group(1)}'] = region_id
            continue
        labels_by_region.setdefault(region_id, []).append(label)

    zones = []
    raycast_zone_count = 0
    seen_region_polygon: dict[int, list[tuple[float, float]]] = {}

    def polygon_for(region_id: int) -> Optional[list[tuple[float, float]]]:
        if region_id not in seen_region_polygon:
            seen_region_polygon[region_id] = _region_contour_polygon(regions, region_id, cell_size)
        return seen_region_polygon[region_id]

    region_label_conflicts = []
    for region_id, labels in labels_by_region.items():
        is_dominant = region_cell_counts.get(region_id, 0) / total_walkable_cells > DOMINANT_REGION_AREA_FRACTION

        if is_dominant:
            # This region is the shared open floor, not a single room -- each
            # label gets its own ray-cast footprint instead of the whole
            # region's shape, so no region_label_conflicts entry either (each
            # zone here is already distinct, nothing to review as a pileup).
            for label in labels:
                cell = label_cell(label['x'], label['y'])
                if cell is None:
                    continue
                row0, col0 = cell
                polygon = _raycast_room_polygon(grid, row0, col0, cell_size, raycast_max_cells)
                centroid = (sum(p[0] for p in polygon) / len(polygon), sum(p[1] for p in polygon) / len(polygon))
                zones.append({
                    'points': [{'x': p[0], 'y': p[1]} for p in polygon],
                    'name': label['text'],
                    'category': _room_category(label['text']),
                    'centroid': {'x': centroid[0], 'y': centroid[1]},
                    'regionId': region_id,
                })
                raycast_zone_count += 1
            continue

        polygon = polygon_for(region_id)
        if polygon is None:
            continue
        if len(labels) > 1:
            region_label_conflicts.append({'regionId': region_id, 'labels': [l['text'] for l in labels]})
        centroid = (sum(p[0] for p in polygon) / len(polygon), sum(p[1] for p in polygon) / len(polygon))
        for label in labels:
            zones.append({
                'points': [{'x': p[0], 'y': p[1]} for p in polygon],
                'name': label['text'],
                'category': _room_category(label['text']),
                'centroid': {'x': centroid[0], 'y': centroid[1]},
                'regionId': region_id,
            })

    # Prefix (workstation-zone) polygons, keyed off the "ZONE <letter>" labels
    # found above -- distinct from room zones, but built with the exact same
    # region-contour machinery.
    prefix_zones = []
    for prefix, region_id in prefix_zone_region.items():
        polygon = polygon_for(region_id)
        if polygon is None:
            continue
        centroid = (sum(p[0] for p in polygon) / len(polygon), sum(p[1] for p in polygon) / len(polygon))
        prefix_zones.append({
            'points': [{'x': p[0], 'y': p[1]} for p in polygon],
            'name': f'Zone {prefix[1:]}' if _PREFIX_LETTER_RE.match(prefix) else prefix,
            'category': _prefix_category(prefix),
            'centroid': {'x': centroid[0], 'y': centroid[1]},
            'regionId': region_id,
        })

    # Link each POI to its prefix zone when one was found; otherwise leave it
    # unlinked rather than guessing -- the prefix itself is still on the POI's
    # own label/name for the admin to see.
    prefix_to_zone_name = {p: z['name'] for p, z in zip(prefix_zone_region.keys(), prefix_zones)}
    for poi in pois:
        poi['zonePrefix'] = poi['prefix']
        poi['zoneName'] = prefix_to_zone_name.get(poi['prefix'])

    return {
        'textLayerAvailable': True,
        'totalLabelsExtracted': total_labels_extracted,
        'pois': pois,
        'duplicatePois': duplicate_labels,
        'zones': zones + prefix_zones,
        'raycastZoneCount': raycast_zone_count,
        'regionLabelConflicts': region_label_conflicts,
        'orphanedLabels': orphaned_labels,
    }


# ---------------------------------------------------------------------------
# Real-world scale calibration
# ---------------------------------------------------------------------------

# "<N> MM WIDE" dimension annotations (e.g. "CORRIDOR 2440 MM WIDE") give the
# true real-world width of the passage they sit in. Measuring that passage's
# pixel width yields mm-per-pixel at the drawing's actual scale -- the only
# honest source of real-world distance, since a scaled architectural plan's
# pixel size has no fixed relationship to real metres (the DPI-derived value is
# page-millimetres, off by the drawing's scale factor, often ~100-300x).
_DIM_VALUE_RE = re.compile(r'^\d{3,5}$')
_INK_MAX = 210  # <= this is linework (see binarize / BACKGROUND_INK_MARGIN)


def _measure_clear_span(ink: np.ndarray, along_axis: int, fixed: int, center: int, max_reach: int) -> Optional[int]:
    """From (center) along the axis perpendicular to a passage, walk out both
    ways to the nearest ink (wall) and return the clear span between them.
    `along_axis` 0 => vary row (measure vertical span at column `fixed`),
    1 => vary column (measure horizontal span at row `fixed`)."""
    n = ink.shape[along_axis]

    def hit(idx: int) -> bool:
        return ink[idx, fixed] if along_axis == 0 else ink[fixed, idx]

    lo = center
    steps = 0
    while lo > 0 and not hit(lo) and steps < max_reach:
        lo -= 1
        steps += 1
    hi = center
    steps = 0
    while hi < n - 1 and not hit(hi) and steps < max_reach:
        hi += 1
        steps += 1
    if not hit(lo) or not hit(hi):
        return None  # ran off the image / reach cap without finding both walls
    return hi - lo


def calibrate_scale(pdf_path: str, image_path: str, dpi: int) -> dict:
    """Derives real-world mm-per-pixel from a "<N> MM WIDE" dimension annotation
    by measuring the passage it labels. Returns {found, pixelToMm, referenceMm,
    measuredPx, label}. found=False (pixelToMm=None) when no such annotation is
    present -- the caller then has no calibrated scale and should show pixels
    rather than a fabricated real-world figure."""
    px_per_pt = dpi / 72.0
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[0]
        words = [w for w in page.extract_words(use_text_flow=False, keep_blank_chars=False)
                 if w.get('upright', True) and w.get('direction') == 'ltr']

    # Find "<N>" followed by "MM ... WIDE". The following tokens may be whole
    # words ("MM", "WIDE") or exploded one glyph per run ("W","I","D","E"), so
    # match against the concatenation of the next several tokens rather than
    # exact word equality.
    annotation = None
    for i, w in enumerate(words):
        if not _DIM_VALUE_RE.match(w['text']):
            continue
        tail = ''.join(r['text'] for r in words[i + 1 : i + 8]).upper()
        if tail.startswith('MM') and 'WIDE' in tail:
            annotation = w
            break
    if annotation is None:
        return {'found': False, 'pixelToMm': None, 'referenceMm': None, 'measuredPx': None, 'label': None}

    reference_mm = int(annotation['text'])
    # Annotation text baseline is horizontal (extract_words already filtered to
    # ltr/upright), so the passage runs horizontally and its width is vertical.
    tx0, tx1 = annotation['x0'] * px_per_pt, annotation['x1'] * px_per_pt
    ty0, ty1 = annotation['top'] * px_per_pt, annotation['bottom'] * px_per_pt
    cy = int((ty0 + ty1) / 2)

    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return {'found': False, 'pixelToMm': None, 'referenceMm': reference_mm, 'measuredPx': None, 'label': annotation['text']}
    ink = img < _INK_MAX
    h, w = ink.shape
    max_reach = int(0.15 * h)

    # Sample clean columns to either side of the annotation text (never through
    # it), measure the vertical clear span at each, and take the mode -- doorways
    # and fixtures produce outlier spans, the true corridor width is the plurality.
    clean = int(60 * px_per_pt)  # band width each side of the text, in px
    spans = []
    for x in list(range(int(tx0) - clean, int(tx0) - 5)) + list(range(int(tx1) + 5, int(tx1) + clean)):
        if 0 <= x < w:
            s = _measure_clear_span(ink, 0, x, cy, max_reach)
            if s and s > 3:
                spans.append(s)
    if not spans:
        return {'found': False, 'pixelToMm': None, 'referenceMm': reference_mm, 'measuredPx': None, 'label': annotation['text']}

    measured_px = Counter(spans).most_common(1)[0][0]
    return {
        'found': True,
        'pixelToMm': reference_mm / measured_px,
        'referenceMm': reference_mm,
        'measuredPx': measured_px,
        'label': annotation['text'],
    }


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

    extract_cmd = sub.add_parser("extract", help="extract POI/zone labels from a PDF's native text layer")
    extract_cmd.add_argument("pdf_path")
    extract_cmd.add_argument("cache_path")
    extract_cmd.add_argument("--dpi", type=int, default=200)

    calibrate_cmd = sub.add_parser("calibrate", help="derive real-world mm/px from a '<N> MM WIDE' annotation")
    calibrate_cmd.add_argument("pdf_path")
    calibrate_cmd.add_argument("image_path")
    calibrate_cmd.add_argument("--dpi", type=int, default=200)

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
            # Not found a path is an expected, everyday outcome (disconnected regions,
            # a destination outside the walkable area), not a crash -- exit 0 so the
            # caller can distinguish it from a real failure and just parse the {error}.
            print(json.dumps({"error": "no path found"}))
            return
        print(json.dumps(result))
    elif args.command == "extract":
        with open(args.cache_path, "r", encoding="utf-8") as f:
            grid_dict = json.load(f)
        print(json.dumps(extract_labels(args.pdf_path, grid_dict, args.dpi)))
    elif args.command == "calibrate":
        print(json.dumps(calibrate_scale(args.pdf_path, args.image_path, args.dpi)))


if __name__ == "__main__":
    main()
