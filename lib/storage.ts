import { promises as fs } from 'fs';
import path from 'path';
import type { FloorPlanSummary, Graph } from './types';

export const DATA_DIR = path.join(process.cwd(), 'data');

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export function floorPlanDir(id: string): string {
  return path.join(DATA_DIR, id);
}

export function graphPath(id: string): string {
  return path.join(floorPlanDir(id), 'graph.json');
}

export function webImagePath(id: string): string {
  return path.join(floorPlanDir(id), 'web.jpg');
}

export async function planExists(id: string): Promise<boolean> {
  try {
    await fs.access(floorPlanDir(id));
    return true;
  } catch {
    return false;
  }
}

export async function readGraph(id: string): Promise<Graph> {
  const raw = await fs.readFile(graphPath(id), 'utf-8');
  return JSON.parse(raw) as Graph;
}

export async function writeGraph(id: string, graph: Graph): Promise<void> {
  await fs.writeFile(graphPath(id), JSON.stringify(graph, null, 2), 'utf-8');
}

export async function listFloorPlans(): Promise<FloorPlanSummary[]> {
  await ensureDataDir();
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const plans: FloorPlanSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const graph = await readGraph(entry.name);
      plans.push({
        id: graph.floorPlan.id,
        name: graph.floorPlan.name,
        createdAt: graph.floorPlan.createdAt,
        thumbnail: `/api/floorplans/${graph.floorPlan.id}/image`,
      });
    } catch {
      // skip malformed/incomplete plan directories
    }
  }

  plans.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return plans;
}

export async function deleteFloorPlan(id: string): Promise<void> {
  await fs.rm(floorPlanDir(id), { recursive: true, force: true });
}
