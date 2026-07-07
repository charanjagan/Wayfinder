import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { floorPlanDir } from '@/lib/storage';

const ALLOWED_FILES = new Set(['threshold.png', 'grid_preview.png', 'zones_overlay.png']);

export async function GET(_request: Request, { params }: { params: { id: string; file: string } }) {
  if (!ALLOWED_FILES.has(params.file)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  try {
    const filePath = path.join(floorPlanDir(params.id), 'debug', params.file);
    const buffer = await fs.readFile(filePath);
    return new NextResponse(buffer, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
}
