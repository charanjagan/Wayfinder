import { promises as fs } from 'fs';
import path from 'path';
import type { Graph, Label, Zone } from './types';

export const DATA_DIR = path.join(process.cwd(), 'data');
export const FLOORPLANS_DIR = path.join(DATA_DIR, 'floorplans');
export const CURRENT_FLOORPLAN_PATH = path.join(DATA_DIR, 'current-floorplan.json');

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(FLOORPLANS_DIR, { recursive: true });
}

export function floorPlanDir(id: string): string {
  return path.join(FLOORPLANS_DIR, id);
}

export function sourcePdfPath(id: string): string {
  return path.join(floorPlanDir(id), 'source.pdf');
}

export function rasterPath(id: string): string {
  return path.join(floorPlanDir(id), 'raster.png');
}

export function occupancyGridPath(id: string): string {
  return path.join(floorPlanDir(id), 'occupancy-grid.json');
}

export function labelsPath(id: string): string {
  return path.join(floorPlanDir(id), 'labels.json');
}

export function zonesPath(id: string): string {
  return path.join(floorPlanDir(id), 'zones.json');
}

export function graphPath(id: string): string {
  return path.join(floorPlanDir(id), 'graph.json');
}

export async function planExists(id: string): Promise<boolean> {
  try {
    await fs.access(floorPlanDir(id));
    return true;
  } catch {
    return false;
  }
}

export async function getCurrentFloorplanId(): Promise<string | null> {
  try {
    const raw = await fs.readFile(CURRENT_FLOORPLAN_PATH, 'utf-8');
    const data = JSON.parse(raw) as { projectId?: string };
    if (data.projectId && (await planExists(data.projectId))) {
      return data.projectId;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setCurrentFloorplanId(id: string): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CURRENT_FLOORPLAN_PATH, JSON.stringify({ projectId: id }, null, 2), 'utf-8');
}

export async function clearCurrentFloorplanId(): Promise<void> {
  await fs.rm(CURRENT_FLOORPLAN_PATH, { force: true });
}

export async function readGraph(id: string): Promise<Graph> {
  const raw = await fs.readFile(graphPath(id), 'utf-8');
  return JSON.parse(raw) as Graph;
}

export async function writeGraph(id: string, graph: Graph): Promise<void> {
  await fs.writeFile(graphPath(id), JSON.stringify(graph, null, 2), 'utf-8');
}

export async function deleteFloorPlan(id: string): Promise<void> {
  await fs.rm(floorPlanDir(id), { recursive: true, force: true });
}

export async function readZones(id: string): Promise<Zone[]> {
  try {
    const raw = await fs.readFile(zonesPath(id), 'utf-8');
    return JSON.parse(raw) as Zone[];
  } catch {
    return [];
  }
}

export async function writeZones(id: string, zones: Zone[]): Promise<void> {
  await fs.writeFile(zonesPath(id), JSON.stringify(zones, null, 2), 'utf-8');
}

export async function readLabels(id: string): Promise<Label[]> {
  try {
    const raw = await fs.readFile(labelsPath(id), 'utf-8');
    return JSON.parse(raw) as Label[];
  } catch {
    return [];
  }
}
