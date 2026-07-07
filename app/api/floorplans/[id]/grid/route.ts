import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import { occupancyGridPath } from '@/lib/storage';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const buffer = await fs.readFile(occupancyGridPath(params.id));
    return new NextResponse(buffer, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  } catch {
    return NextResponse.json({ error: 'Occupancy grid not found.' }, { status: 404 });
  }
}
