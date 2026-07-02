import type { Edge, Graph, POI, Waypoint } from './types';

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nearestWaypointId(waypoints: Waypoint[], point: { x: number; y: number }): string | null {
  let best: Waypoint | null = null;
  let bestDist = Infinity;
  for (const wp of waypoints) {
    const d = distance(wp, point);
    if (d < bestDist) {
      bestDist = d;
      best = wp;
    }
  }
  return best?.id ?? null;
}

type Adjacency = Map<string, { to: string; weight: number }[]>;

function buildAdjacency(waypoints: Waypoint[], edges: Edge[]): Adjacency {
  const byId = new Map(waypoints.map((w) => [w.id, w]));
  const adj: Adjacency = new Map(waypoints.map((w) => [w.id, []]));
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const weight = distance(from, to);
    adj.get(edge.from)?.push({ to: edge.to, weight });
    adj.get(edge.to)?.push({ to: edge.from, weight });
  }
  return adj;
}

function dijkstra(adj: Adjacency, startId: string): { dist: Map<string, number>; prev: Map<string, string | null> } {
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();

  for (const id of adj.keys()) {
    dist.set(id, Infinity);
    prev.set(id, null);
  }
  dist.set(startId, 0);

  while (visited.size < adj.size) {
    let currentId: string | null = null;
    let currentDist = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < currentDist) {
        currentDist = d;
        currentId = id;
      }
    }
    if (currentId === null) break;
    visited.add(currentId);

    for (const { to, weight } of adj.get(currentId) ?? []) {
      if (visited.has(to)) continue;
      const alt = currentDist + weight;
      if (alt < (dist.get(to) ?? Infinity)) {
        dist.set(to, alt);
        prev.set(to, currentId);
      }
    }
  }

  return { dist, prev };
}

export interface RouteResult {
  points: { x: number; y: number }[];
  distance: number;
}

export function routeBetweenPois(graph: Graph, startPoiId: string, endPoiId: string): RouteResult | null {
  const poiById = new Map(graph.pois.map((p) => [p.id, p]));
  const start = poiById.get(startPoiId);
  const end = poiById.get(endPoiId);
  if (!start || !end) return null;

  if (start.id === end.id) {
    return { points: [{ x: start.x, y: start.y }], distance: 0 };
  }

  const wpById = new Map(graph.waypoints.map((w) => [w.id, w]));
  const startWp = wpById.get(start.nearestWaypoint);
  const endWp = wpById.get(end.nearestWaypoint);
  if (!startWp || !endWp) return null;

  if (startWp.id === endWp.id) {
    const d = distance(start, startWp) + distance(startWp, end);
    return {
      points: [
        { x: start.x, y: start.y },
        { x: startWp.x, y: startWp.y },
        { x: end.x, y: end.y },
      ],
      distance: d,
    };
  }

  const adj = buildAdjacency(graph.waypoints, graph.edges);
  const { dist, prev } = dijkstra(adj, startWp.id);

  const totalToEnd = dist.get(endWp.id);
  if (totalToEnd === undefined || totalToEnd === Infinity) return null;

  const waypointPath: string[] = [];
  let cur: string | null = endWp.id;
  while (cur !== null) {
    waypointPath.unshift(cur);
    cur = prev.get(cur) ?? null;
  }

  const points = [
    { x: start.x, y: start.y },
    ...waypointPath.map((id) => {
      const wp = wpById.get(id)!;
      return { x: wp.x, y: wp.y };
    }),
    { x: end.x, y: end.y },
  ];

  const totalDistance = distance(start, startWp) + totalToEnd + distance(endWp, end);

  return { points, distance: totalDistance };
}
