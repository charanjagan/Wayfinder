import { NextResponse } from 'next/server';
import path from 'path';
import { readFloorConfig } from '@/lib/storage';
import { detectZones, gridCachePath } from '@/lib/navgrid';

const DATA_DIR = path.join(process.cwd(), 'data');

export async function POST(_request: Request, { params }: { params: { floorId: string } }) {
  const config = await readFloorConfig(params.floorId);
  if (!config) {
    return NextResponse.json({ error: 'floor not found' }, { status: 404 });
  }
  if (!config.grid || !config.sourceImagePath) {
    return NextResponse.json({ error: 'floor has no grid yet' }, { status: 400 });
  }

  const cachePath = gridCachePath(params.floorId, DATA_DIR);
  const result = await detectZones(cachePath, config.sourceImagePath);
  return NextResponse.json(result);
}
