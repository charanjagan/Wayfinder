export interface OccupancyGrid {
  width: number;
  height: number;
  cellSizePx: number;
  /** grid[row][col]: 0 = walkable, 1 = wall/occupied */
  grid: number[][];
  /**
   * Connected-component label per cell, computed once at grid-generation time
   * (cv2.connectedComponents / scipy.ndimage.label) and cached here so pathfinding
   * queries never re-run flood-fill. 0 = wall/unlabeled, >=1 = component id.
   */
  regions: number[][];
  /** Per-cell distance (in cells) to the nearest wall, used to bias A* toward corridor centers. */
  distanceTransform: number[][];
}

export const ZONE_CATEGORIES = [
  'Workstation A',
  'Workstation B',
  'Workstation C',
  'Workstation D',
  'Workstation E',
  'Workstation F',
  'Workstation G',
  'Workstation H',
  'Workstation I',
  'ODC',
  'Meeting Room',
  'Cabin',
  'Cafeteria',
  'Lift Lobby',
  'Other',
] as const;

export type ZoneCategory = (typeof ZONE_CATEGORIES)[number];

export interface Zone {
  id: string;
  name: string;
  category: ZoneCategory;
  points: { x: number; y: number }[];
  hidden: boolean;
}

export interface POI {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  zoneId: string | null;
}

export interface FloorConfig {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourceImagePath: string | null;
  /** mm per source-image pixel, known only when the source was rasterized from a PDF
   * at a known DPI. Null for plain image uploads with no calibrated real-world scale. */
  pixelToMm: number | null;
  grid: OccupancyGrid | null;
  zones: Zone[];
  pois: POI[];
}
