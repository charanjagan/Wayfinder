import { findGridPath, type OccupancyGrid } from './pathfinding';
import type { Zone } from './types';

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointInPolygon(point: { x: number; y: number }, points: [number, number][]): boolean {
  const { x, y } = point;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonCentroid(points: [number, number][]): { x: number; y: number } {
  const sum = points.reduce((acc, [x, y]) => ({ x: acc.x + x, y: acc.y + y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** Single source of truth for which zones a visitor is allowed to see. */
export function filterVisible(zones: Zone[]): Zone[] {
  return zones.filter((z) => !z.hidden);
}

export interface RouteResult {
  points: { x: number; y: number }[];
  distance: number;
}

/**
 * Routes directly from the fixed "You Are Here" point to the selected zone's centroid.
 * With grid pathfinding falls back to a straight line only if the grid genuinely can't
 * connect them (disconnected regions); without a grid (not yet loaded), a straight line
 * is the best available approximation until it arrives.
 */
export function routeToZone(youAreHere: { x: number; y: number }, zone: Zone, grid?: OccupancyGrid): RouteResult | null {
  const target = polygonCentroid(zone.points);

  if (!grid) {
    return { points: [youAreHere, target], distance: distance(youAreHere, target) };
  }

  const result = findGridPath(grid, youAreHere, target);
  if (!result) {
    return { points: [youAreHere, target], distance: distance(youAreHere, target) };
  }
  return { points: result.points, distance: result.distancePx };
}
