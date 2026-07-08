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
  return parsed as RouteResult;
}

export interface DetectedZoneRaw {
  points: RoutePoint[];
  name: string;
  category: string;
  ocrText: string | null;
  centroid: RoutePoint;
}

export interface DetectZonesResult {
  ocrAvailable: boolean;
  zones: DetectedZoneRaw[];
}

/** Auto-detects zone polygons from the cached grid's connected-component regions
 * and OCRs each one's bounding box for a name/category guess. Read-only: never
 * writes to any config, the caller decides what (if anything) to keep. */
export async function detectZones(gridFilePath: string, sourceImagePath: string): Promise<DetectZonesResult> {
  const stdout = await run(['detect', gridFilePath, sourceImagePath]);
  return JSON.parse(stdout);
}

export type { OccupancyGrid };
