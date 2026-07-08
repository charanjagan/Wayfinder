import { promises as fs } from 'fs';
import path from 'path';
import type { FloorConfig } from './types';

const FLOORS_ROOT = path.join(process.cwd(), 'data', 'floors');

function floorDir(floorId: string): string {
  return path.join(FLOORS_ROOT, floorId);
}

function configPath(floorId: string): string {
  return path.join(floorDir(floorId), 'config.json');
}

export async function listFloors(): Promise<string[]> {
  await fs.mkdir(FLOORS_ROOT, { recursive: true });
  const entries = await fs.readdir(FLOORS_ROOT, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export async function readFloorConfig(floorId: string): Promise<FloorConfig | null> {
  try {
    const raw = await fs.readFile(configPath(floorId), 'utf-8');
    return JSON.parse(raw) as FloorConfig;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeFloorConfig(config: FloorConfig): Promise<void> {
  const dir = floorDir(config.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath(config.id), JSON.stringify(config));
}

export function createEmptyFloorConfig(id: string, name: string): FloorConfig {
  const now = new Date().toISOString();
  return {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    sourceImagePath: null,
    pixelToMm: null,
    grid: null,
    zones: [],
    pois: [],
  };
}

export function floorSourcePath(floorId: string, filename: string): string {
  return path.join(floorDir(floorId), filename);
}
