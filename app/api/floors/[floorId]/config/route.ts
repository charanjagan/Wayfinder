import { NextRequest, NextResponse } from 'next/server';
import { readFloorConfig, writeFloorConfig } from '@/lib/storage';
import { requireAdminApi } from '@/lib/adminAuth';
import type { POI, Zone } from '@/lib/types';

export async function GET(_request: NextRequest, { params }: { params: { floorId: string } }) {
  const config = await readFloorConfig(params.floorId);
  if (!config) {
    return NextResponse.json({ error: 'floor not found' }, { status: 404 });
  }
  return NextResponse.json(config);
}

export async function POST(request: NextRequest, { params }: { params: { floorId: string } }) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;

  const config = await readFloorConfig(params.floorId);
  if (!config) {
    return NextResponse.json({ error: 'floor not found' }, { status: 404 });
  }
  if (!config.sourceImagePath) {
    return NextResponse.json({ error: 'floor plan not uploaded yet' }, { status: 400 });
  }

  const body = (await request.json()) as Partial<{
    name: string;
    zones: Zone[];
    pois: POI[];
    origin: { x: number; y: number } | null;
  }>;
  if (body.name !== undefined) config.name = body.name;
  if (body.zones !== undefined) config.zones = body.zones;
  if (body.pois !== undefined) config.pois = body.pois;
  if (body.origin !== undefined) config.origin = body.origin;
  config.updatedAt = new Date().toISOString();

  await writeFloorConfig(config);
  return NextResponse.json(config);
}
