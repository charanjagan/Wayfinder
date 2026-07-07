export interface OccupancyGrid {
  width: number;
  height: number;
  cellSizePx: number;
  grid: number[][]; // grid[row][col]: 0 = walkable, 1 = wall
}

interface Cell {
  col: number;
  row: number;
}

const SNAP_SEARCH_RADIUS = 40; // cells; ~320px at cellSizePx=8, generous enough for any furniture blob

function pixelToCell(point: { x: number; y: number }, grid: OccupancyGrid): Cell {
  return {
    col: Math.min(grid.width - 1, Math.max(0, Math.floor(point.x / grid.cellSizePx))),
    row: Math.min(grid.height - 1, Math.max(0, Math.floor(point.y / grid.cellSizePx))),
  };
}

function cellToPixel(cell: Cell, grid: OccupancyGrid): { x: number; y: number } {
  return { x: (cell.col + 0.5) * grid.cellSizePx, y: (cell.row + 0.5) * grid.cellSizePx };
}

function isWalkable(grid: OccupancyGrid, cell: Cell): boolean {
  if (cell.row < 0 || cell.row >= grid.height || cell.col < 0 || cell.col >= grid.width) return false;
  return grid.grid[cell.row][cell.col] === 0;
}

/**
 * POI coordinates come from PDF label positions, which often sit on/inside furniture icons
 * that the occupancy grid classified as "wall". Spiral outward from the requested cell to
 * find the nearest actually-walkable one to start/end the search from.
 */
function nearestWalkable(grid: OccupancyGrid, cell: Cell): Cell | null {
  if (isWalkable(grid, cell)) return cell;
  for (let radius = 1; radius <= SNAP_SEARCH_RADIUS; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue; // only the ring perimeter
        const candidate = { col: cell.col + dx, row: cell.row + dy };
        if (isWalkable(grid, candidate)) return candidate;
      }
    }
  }
  return null;
}

class MinHeap<T> {
  private items: { priority: number; value: T }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(priority: number, value: T): void {
    this.items.push({ priority, value });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = i * 2 + 2;
        let smallest = i;
        if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
        if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top.value;
  }
}

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

function cellKey(cell: Cell): number {
  return cell.row * 100000 + cell.col;
}

function aStar(grid: OccupancyGrid, start: Cell, end: Cell): Cell[] | null {
  const startKey = cellKey(start);
  const endKey = cellKey(end);
  const gScore = new Map<number, number>([[startKey, 0]]);
  const cameFrom = new Map<number, Cell>();
  const open = new MinHeap<Cell>();
  const heuristic = (c: Cell) => Math.hypot(c.col - end.col, c.row - end.row);
  open.push(heuristic(start), start);
  const visited = new Set<number>();

  while (open.size > 0) {
    const current = open.pop()!;
    const currentKey = cellKey(current);
    if (currentKey === endKey) {
      const path: Cell[] = [current];
      let key = currentKey;
      while (cameFrom.has(key)) {
        const prev = cameFrom.get(key)!;
        path.push(prev);
        key = cellKey(prev);
      }
      return path.reverse();
    }
    if (visited.has(currentKey)) continue;
    visited.add(currentKey);

    for (const [dc, dr, cost] of NEIGHBORS) {
      const neighbor = { col: current.col + dc, row: current.row + dr };
      if (!isWalkable(grid, neighbor)) continue;
      // Prevent cutting diagonally through a wall corner (both orthogonal cells blocked).
      if (dc !== 0 && dr !== 0) {
        if (!isWalkable(grid, { col: current.col + dc, row: current.row }) ||
            !isWalkable(grid, { col: current.col, row: current.row + dr })) {
          continue;
        }
      }
      const neighborKey = cellKey(neighbor);
      const tentativeG = (gScore.get(currentKey) ?? Infinity) + cost;
      if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
        gScore.set(neighborKey, tentativeG);
        cameFrom.set(neighborKey, current);
        open.push(tentativeG + heuristic(neighbor), neighbor);
      }
    }
  }
  return null;
}

function hasLineOfSight(grid: OccupancyGrid, a: Cell, b: Cell): boolean {
  // Bresenham's line, checking every traversed cell stays walkable.
  let x0 = a.col;
  let y0 = a.row;
  const x1 = b.col;
  const y1 = b.row;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (!isWalkable(grid, { col: x0, row: y0 })) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    const stepX = e2 >= dy;
    const stepY = e2 <= dx;
    // Same corner-cutting guard as the A* neighbor expansion: a Bresenham step that moves
    // diagonally can hop past a single-cell wall corner without ever visiting it, reporting
    // clear line-of-sight through a wall. Reject the diagonal unless both orthogonal cells
    // it's cutting between are also walkable.
    if (stepX && stepY) {
      if (!isWalkable(grid, { col: x0 + sx, row: y0 }) || !isWalkable(grid, { col: x0, row: y0 + sy })) {
        return false;
      }
    }
    if (stepX) {
      err += dy;
      x0 += sx;
    }
    if (stepY) {
      err += dx;
      y0 += sy;
    }
  }
}

/** String-pulling: collapse a stair-stepped grid path into the fewest straight segments
 * that still never cross a wall, so the rendered route looks like a real walked path. */
function simplifyPath(grid: OccupancyGrid, cells: Cell[]): Cell[] {
  if (cells.length <= 2) return cells;
  const simplified: Cell[] = [cells[0]];
  let anchor = 0;
  for (let i = 1; i < cells.length; i += 1) {
    if (i === cells.length - 1 || !hasLineOfSight(grid, cells[anchor], cells[i + 1])) {
      simplified.push(cells[i]);
      anchor = i;
    }
  }
  return simplified;
}

export interface GridPathResult {
  points: { x: number; y: number }[];
  distancePx: number;
}

/** Finds a wall-avoiding path between two points in pixel space. Returns null if no walkable
 * route connects them (disconnected regions, or no walkable cell found near either end). */
export function findGridPath(
  grid: OccupancyGrid,
  startPx: { x: number; y: number },
  endPx: { x: number; y: number },
): GridPathResult | null {
  const startCell = nearestWalkable(grid, pixelToCell(startPx, grid));
  const endCell = nearestWalkable(grid, pixelToCell(endPx, grid));
  if (!startCell || !endCell) return null;

  const cellPath = aStar(grid, startCell, endCell);
  if (!cellPath) return null;

  const simplified = simplifyPath(grid, cellPath);
  const points = [startPx, ...simplified.map((c) => cellToPixel(c, grid)), endPx];

  let distancePx = 0;
  for (let i = 1; i < points.length; i += 1) {
    distancePx += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }

  return { points, distancePx };
}
