import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { newId } from '@/lib/id';
import { processUpload } from '@/lib/imageProcessing';
import { deleteFloorPlan, ensureDataDir, floorPlanDir, listFloorPlans, writeGraph } from '@/lib/storage';
import type { Graph } from '@/lib/types';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

export async function GET() {
  const plans = await listFloorPlans();
  return NextResponse.json({ plans });
}

export async function POST(request: NextRequest) {
  await ensureDataDir();

  const formData = await request.formData();
  const file = formData.get('file');
  const nameField = formData.get('name');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: 'Unsupported file type. Upload a PDF, PNG, or JPG.' }, { status: 400 });
  }

  const id = newId('plan');
  const dir = floorPlanDir(id);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const processed = await processUpload(buffer, file.name, dir);

    const displayName =
      typeof nameField === 'string' && nameField.trim() ? nameField.trim() : path.basename(file.name, ext);

    const graph: Graph = {
      floorPlan: {
        id,
        name: displayName,
        createdAt: new Date().toISOString(),
        imageWidth: processed.width,
        imageHeight: processed.height,
      },
      waypoints: [],
      edges: [],
      pois: [],
    };

    await writeGraph(id, graph);

    return NextResponse.json({ id });
  } catch (err) {
    await deleteFloorPlan(id);
    const message = err instanceof Error ? err.message : 'Failed to process upload.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
