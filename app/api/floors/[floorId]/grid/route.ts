import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readFloorConfig, writeFloorConfig } from '@/lib/storage';
import { generateGrid, gridCachePath } from '@/lib/navgrid';
import { promises as fs } from 'fs';
import type { OccupancyGrid } from '@/lib/types';
import { requireAdminApi } from '@/lib/adminAuth';

const DATA_DIR = path.join(process.cwd(), 'data');

export async function POST(request: NextRequest, { params }: { params: { floorId: string } }) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;

  const config = await readFloorConfig(params.floorId);
  if (!config) {
    return NextResponse.json({ error: 'floor not found' }, { status: 404 });
  }
  if (!config.sourceImagePath) {
    return NextResponse.json({ error: 'floor has no source image' }, { status: 400 });
  }

  const cellSizePx = Number(request.nextUrl.searchParams.get('cellSizePx') ?? 8);
  const cachePath = gridCachePath(params.floorId, DATA_DIR);

  await generateGrid(config.sourceImagePath, cachePath, cellSizePx);
  const cached = JSON.parse(await fs.readFile(cachePath, 'utf-8'));

  const grid: OccupancyGrid = {
    width: cached.width,
    height: cached.height,
    cellSizePx: cached.cellSizePx,
    grid: cached.grid,
    regions: cached.regions,
    distanceTransform: cached.distanceTransform,
  };

  config.grid = grid;
  config.updatedAt = new Date().toISOString();
  await writeFloorConfig(config);

  return NextResponse.json({ width: grid.width, height: grid.height });
}
