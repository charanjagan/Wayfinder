"""Benchmarks the optimized floorplan_navgrid.py against a naive reference
implementation of the same three stages: grid generation, a single A* query,
and path simplification.

The naive reference mirrors the pre-optimization approach described in the
spec: fixed kernel size, fixed threshold, linear open-set scan for A*,
Euclidean (not octile) heuristic, no distance-transform cost bias, and
per-query flood-fill instead of a cached connected-components pass.

Usage: python benchmark.py [image_path] [--queries 20]
(with no image_path, generates a synthetic floorplan to benchmark against)
"""
from __future__ import annotations

import math
import os
import sys
import tempfile
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import floorplan_navgrid as opt  # optimized implementation under test


# ---------------------------------------------------------------------------
# Naive reference implementation (pre-optimization baseline)
# ---------------------------------------------------------------------------

NAIVE_KERNEL_SIZE = 5  # fixed, not resolution-adaptive
NAIVE_THRESHOLD = 127  # fixed, not Otsu/adaptive


def naive_build_occupancy_grid(image_path: str, cell_size_px: int = 8) -> dict:
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    h, w = img.shape

    _, thresh = cv2.threshold(img, NAIVE_THRESHOLD, 255, cv2.THRESH_BINARY_INV)

    kernel = np.ones((NAIVE_KERNEL_SIZE, NAIVE_KERNEL_SIZE), np.uint8)
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, kernel)

    grid_w = max(1, w // cell_size_px)
    grid_h = max(1, h // cell_size_px)
    resized = cv2.resize(opened, (grid_w, grid_h), interpolation=cv2.INTER_AREA)
    grid = (resized > 127).astype(np.uint8)
    return {"width": grid_w, "height": grid_h, "cellSizePx": cell_size_px, "grid": grid}


def naive_flood_fill_region(grid: np.ndarray, start: tuple[int, int]) -> set[tuple[int, int]]:
    """Manual BFS flood-fill, run from scratch on every call (no caching)."""
    h, w = grid.shape
    visited = {start}
    stack = [start]
    while stack:
        r, c = stack.pop()
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < h and 0 <= nc < w and grid[nr, nc] == 0 and (nr, nc) not in visited:
                visited.add((nr, nc))
                stack.append((nr, nc))
    return visited


def naive_astar(grid: np.ndarray, start: tuple[int, int], goal: tuple[int, int]):
    """Linear min-scan open set (list, not heap) + Euclidean heuristic."""
    h, w = grid.shape

    def walkable(r, c):
        return 0 <= r < h and 0 <= c < w and grid[r, c] == 0

    if not walkable(*start) or not walkable(*goal):
        return None

    open_set = [start]
    g_score = {start: 0.0}
    came_from = {}

    def heuristic(a, b):
        return math.hypot(a[0] - b[0], a[1] - b[1])

    while open_set:
        # linear scan for lowest f-score -- O(n) per pop instead of O(log n)
        current = min(open_set, key=lambda c: g_score[c] + heuristic(c, goal))
        if current == goal:
            path = [current]
            while current in came_from:
                current = came_from[current]
                path.append(current)
            path.reverse()
            return path
        open_set.remove(current)

        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            neighbor = (current[0] + dr, current[1] + dc)
            if not walkable(*neighbor):
                continue
            cost = math.sqrt(2) if dr != 0 and dc != 0 else 1.0
            tentative_g = g_score[current] + cost
            if tentative_g < g_score.get(neighbor, math.inf):
                g_score[neighbor] = tentative_g
                came_from[neighbor] = current
                if neighbor not in open_set:
                    open_set.append(neighbor)
    return None


def naive_douglas_peucker(points, epsilon=3.0):
    """Fixed epsilon, independent of grid resolution."""
    return opt.douglas_peucker(points, epsilon)


# ---------------------------------------------------------------------------
# Benchmark harness
# ---------------------------------------------------------------------------

def make_synthetic_image(path: str, w: int = 1200, h: int = 800) -> None:
    img = np.full((h, w), 255, dtype=np.uint8)
    cv2.rectangle(img, (0, 0), (w - 1, h - 1), 0, 12)
    # a few internal partition walls with corridor gaps, repeated across the floor
    for x in range(200, w - 200, 250):
        cv2.rectangle(img, (x, 0), (x + 20, h // 2 - 60), 0, -1)
        cv2.rectangle(img, (x, h // 2 + 60), (x + 20, h), 0, -1)
    cv2.imwrite(path, img)


def bench(label: str, fn, repeat: int = 1) -> float:
    t0 = time.perf_counter()
    for _ in range(repeat):
        fn()
    elapsed = (time.perf_counter() - t0) / repeat
    print(f"  {label:<32} {elapsed * 1000:10.3f} ms")
    return elapsed


def main() -> None:
    args = sys.argv[1:]
    queries = 20
    if "--queries" in args:
        idx = args.index("--queries")
        queries = int(args[idx + 1])
        del args[idx : idx + 2]

    tmp_dir = tempfile.mkdtemp(prefix="wayfinder_bench_")
    if args:
        image_path = args[0]
    else:
        image_path = os.path.join(tmp_dir, "synthetic.png")
        make_synthetic_image(image_path)
        print(f"(no image given, generated synthetic floorplan at {image_path})")

    cache_path = os.path.join(tmp_dir, "cache.json")
    cell_size_px = 8

    print("\n=== Grid generation ===")
    bench("naive (fixed kernel/thresh)", lambda: naive_build_occupancy_grid(image_path, cell_size_px))
    if os.path.exists(cache_path):
        os.remove(cache_path)
    bench(
        "optimized (adaptive+denoise+cache)",
        lambda: opt.generate_and_cache_grid(image_path, cache_path, cell_size_px),
    )
    # second call should hit the cache and be near-instant
    bench("optimized (cache hit)", lambda: opt.generate_and_cache_grid(image_path, cache_path, cell_size_px))

    naive_grid = naive_build_occupancy_grid(image_path, cell_size_px)["grid"]
    opt_grid_dict = opt.generate_and_cache_grid(image_path, cache_path, cell_size_px)
    opt_grid_data = opt.GridData.from_dict(opt_grid_dict)

    h, w = naive_grid.shape
    start = (h // 2, 2)
    goal = (h // 2, w - 3)
    # nudge onto walkable cells if needed
    while naive_grid[start] != 0 and start[1] < w - 1:
        start = (start[0], start[1] + 1)
    while naive_grid[goal] != 0 and goal[1] > 0:
        goal = (goal[0], goal[1] - 1)

    print(f"\n=== Single A* query ({queries}x, includes naive's per-query flood-fill) ===")

    def naive_query():
        naive_flood_fill_region(naive_grid, start)  # no caching: redone every query
        return naive_astar(naive_grid, start, goal)

    def opt_query():
        return opt.astar(opt_grid_data, start, goal)

    naive_path = bench("naive (list scan + per-query flood)", naive_query, repeat=queries)
    opt_path = bench("optimized (heap + cached regions)", opt_query, repeat=queries)

    print("\n=== Path simplification (Douglas-Peucker) ===")
    sample_path = [(r, c) for r, c in (naive_astar(naive_grid, start, goal) or [])]
    if sample_path:
        points = [(c * cell_size_px, r * cell_size_px) for r, c in sample_path]
        bench("naive (fixed epsilon=3.0px)", lambda: naive_douglas_peucker(points, 3.0), repeat=queries)
        bench(
            "optimized (epsilon scaled to grid res)",
            lambda: opt.simplify_cell_path(sample_path, cell_size_px),
            repeat=queries,
        )
    else:
        print("  (no path found on synthetic image to simplify)")

    print()


if __name__ == "__main__":
    main()
