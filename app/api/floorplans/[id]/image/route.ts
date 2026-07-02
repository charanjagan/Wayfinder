import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import { webImagePath } from '@/lib/storage';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const buffer = await fs.readFile(webImagePath(params.id));
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
  }
}
