import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { readFloorConfig } from '@/lib/storage';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export async function GET(_request: Request, { params }: { params: { floorId: string } }) {
  const config = await readFloorConfig(params.floorId);
  if (!config || !config.sourceImagePath) {
    return NextResponse.json({ error: 'no source image' }, { status: 404 });
  }

  const ext = path.extname(config.sourceImagePath).toLowerCase();
  const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';

  const bytes = await fs.readFile(config.sourceImagePath);
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    },
  });
}
