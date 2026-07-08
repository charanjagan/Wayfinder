import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { readFloorConfig } from '@/lib/storage';
import { findRoute, gridCachePath } from '@/lib/navgrid';

const DATA_DIR = path.join(process.cwd(), 'data');

export async function POST(request: NextRequest, { params }: { params: { floorId: string } }) {
  const config = await readFloorConfig(params.floorId);
  if (!config) {
    return NextResponse.json({ error: 'floor not found' }, { status: 404 });
  }
  if (!config.grid) {
    return NextResponse.json({ error: 'floor has no grid yet' }, { status: 400 });
  }

  const body = await request.json();
  const { start, end } = body as { start: { x: number; y: number }; end: { x: number; y: number } };

  const result = await findRoute(gridCachePath(params.floorId, DATA_DIR), start, end);
  if (!result) {
    return NextResponse.json({ error: 'no path found' }, { status: 404 });
  }
  return NextResponse.json(result);
}
