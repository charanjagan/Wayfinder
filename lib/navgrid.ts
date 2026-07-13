import { spawn } from 'child_process';
import path from 'path';
import type { OccupancyGrid } from './types';

const PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3';
const NAVGRID_SCRIPT = path.join(process.cwd(), 'scripts', 'floorplan_navgrid.py');

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [NAVGRID_SCRIPT, ...args], { cwd: process.cwd() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf-8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf-8')));
    child.on('close', (code) => {
      if (code !== 0) {
        // A structured {"error": ...} payload on stdout means the script ran to
        // completion and reported an expected outcome (e.g. "no path found"), not a
        // crash -- let the caller's own parsing (e.g. findRoute's `if (parsed.error)`)
        // handle it instead of treating every non-zero exit as a hard failure.
        const trimmed = stdout.trim();
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && 'error' in parsed) {
              resolve(trimmed);
              return;
            }
          } catch {
            // not a structured payload -- fall through and treat as a hard failure
          }
        }
        reject(new Error(stderr.trim() || `floorplan_navgrid.py exited with code ${code}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export function gridCachePath(floorId: string, dataDir: string): string {
  return path.join(dataDir, 'floors', floorId, 'grid-cache.json');
}

/** Builds (or loads, if the source image is unchanged) the occupancy grid for a floor's
 * source image. Grid generation only ever runs here, once per floor plan -- pathfinding
 * queries read the cached result back out via config.json, never recomputing it. */
export async function generateGrid(
  imagePath: string,
  cachePath: string,
  cellSizePx = 8,
): Promise<{ elapsedSec: number; width: number; height: number }> {
  const stdout = await run(['grid', imagePath, cachePath, '--cell-size-px', String(cellSizePx)]);
  return JSON.parse(stdout);
}

export interface RoutePoint {
  x: number;
  y: number;
}

export interface RouteResult {
  points: RoutePoint[];
  distancePx: number;
}

/** Runs A* + Douglas-Peucker simplification between two pixel points against an
 * already-generated grid cache file (see gridCachePath). */
export async function findRoute(
  gridFilePath: string,
  start: RoutePoint,
  end: RoutePoint,
): Promise<RouteResult | null> {
  const stdout = await run([
    'route',
    gridFilePath,
    String(start.x),
    String(start.y),
    String(end.x),
    String(end.y),
  ]);
  const parsed = JSON.parse(stdout);
  if (parsed.error) return null;
  // The python script emits points as [x, y] tuples; the rest of the app (route
  // polyline, buildDirections) reads them as {x, y} objects. Normalize here so the
  // RouteResult contract is actually honored instead of just cast onto.
  return {
    points: (parsed.points as [number, number][]).map(([x, y]) => ({ x, y })),
    distancePx: parsed.distancePx,
  };
}

export interface ExtractedZoneRaw {
  points: RoutePoint[];
  name: string;
  category: string;
  centroid: RoutePoint;
  regionId: number;
}

export interface ExtractedPoiRaw {
  label: string;
  prefix: string;
  type: string;
  x: number;
  y: number;
  zonePrefix: string;
  zoneName: string | null;
}

export interface RegionLabelConflict {
  regionId: number;
  labels: string[];
}

export interface OrphanedLabel {
  text: string;
  x: number;
  y: number;
}

export interface ExtractLabelsResult {
  textLayerAvailable: boolean;
  totalLabelsExtracted: number;
  pois: ExtractedPoiRaw[];
  duplicatePois: Record<string, number>;
  zones: ExtractedZoneRaw[];
  regionLabelConflicts: RegionLabelConflict[];
  orphanedLabels: OrphanedLabel[];
}

/** Extracts POI/zone labels from a PDF's native text layer (no OCR -- this
 * replaces the old raster+tesseract detector for floors that were uploaded as
 * a PDF with a real text layer). Read-only: never writes to any config, the
 * caller decides what (if anything) to keep. */
export async function extractLabels(pdfPath: string, gridFilePath: string, dpi: number): Promise<ExtractLabelsResult> {
  const stdout = await run(['extract', pdfPath, gridFilePath, '--dpi', String(dpi)]);
  return JSON.parse(stdout);
}

export interface CalibrateResult {
  found: boolean;
  /** Real-world millimetres per source-image pixel, or null when no dimension
   * annotation was found (scale unknown -- distances should show pixels). */
  pixelToMm: number | null;
  referenceMm: number | null;
  measuredPx: number | null;
  label: string | null;
}

/** Derives the drawing's real-world mm-per-pixel from a "<N> MM WIDE" dimension
 * annotation (e.g. "CORRIDOR 2440 MM WIDE") by measuring the passage it labels.
 * The DPI-derived value is only page-millimetres and is wrong by the drawing's
 * scale factor, so this reference-based measurement is the only real-world scale. */
export async function calibrateScale(pdfPath: string, imagePath: string, dpi: number): Promise<CalibrateResult> {
  const stdout = await run(['calibrate', pdfPath, imagePath, '--dpi', String(dpi)]);
  return JSON.parse(stdout);
}

export type { OccupancyGrid };
