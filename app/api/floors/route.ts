import { NextResponse } from 'next/server';
import { listFloors, readFloorConfig } from '@/lib/storage';

export async function GET() {
  const ids = await listFloors();
  const floors = await Promise.all(
    ids.map(async (id) => {
      const config = await readFloorConfig(id);
      return { id, name: config?.name ?? id };
    }),
  );
  return NextResponse.json(floors);
}
