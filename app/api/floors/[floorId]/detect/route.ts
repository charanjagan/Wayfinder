import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { readFloorConfig, floorSourcePath } from '@/lib/storage';
import { extractLabels, gridCachePath } from '@/lib/navgrid';
import { PDF_RASTER_DPI } from '@/lib/rasterize';

const DATA_DIR = path.join(process.cwd(), 'data');

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function POST(_request: Request, { params }: { params: { floorId: string } }) {
  const config = await readFloorConfig(params.floorId);
  if (!config) {
    return NextResponse.json({ error: 'floor not found' }, { status: 404 });
  }
  if (!config.grid || !config.sourceImagePath) {
    return NextResponse.json({ error: 'floor has no grid yet' }, { status: 400 });
  }

  // The rasterized source image (used for grid gen) always lives alongside the
  // original PDF, if one was uploaded -- see upload/route.ts. Plain image
  // uploads have no PDF and therefore no text layer to extract from.
  const pdfPath = floorSourcePath(params.floorId, 'source.pdf');
  if (!(await fileExists(pdfPath))) {
    return NextResponse.json({
      textLayerAvailable: false,
      totalLabelsExtracted: 0,
      pois: [],
      duplicatePois: {},
      zones: [],
      regionLabelConflicts: [],
      orphanedLabels: [],
    });
  }

  const cachePath = gridCachePath(params.floorId, DATA_DIR);
  const result = await extractLabels(pdfPath, cachePath, PDF_RASTER_DPI);
  return NextResponse.json(result);
}
