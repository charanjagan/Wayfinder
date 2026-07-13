import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { readFloorConfig, writeFloorConfig, floorSourcePath } from '@/lib/storage';
import { rasterizePdf, PDF_RASTER_DPI } from '@/lib/rasterize';
import { calibrateScale } from '@/lib/navgrid';
import { requireAdminApi } from '@/lib/adminAuth';

export async function POST(request: NextRequest, { params }: { params: { floorId: string } }) {
  const authError = await requireAdminApi(request);
  if (authError) return authError;

  const config = await readFloorConfig(params.floorId);
  if (!config) {
    return NextResponse.json({ error: 'floor not found' }, { status: 404 });
  }

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing file' }, { status: 400 });
  }

  const originalName = file.name.toLowerCase();
  const isPdf = originalName.endsWith('.pdf') || file.type === 'application/pdf';
  const buffer = Buffer.from(await file.arrayBuffer());

  let sourceImagePath: string;
  let pixelToMm: number | null;

  if (isPdf) {
    const pdfPath = floorSourcePath(params.floorId, 'source.pdf');
    await fs.writeFile(pdfPath, buffer);
    const outputBase = floorSourcePath(params.floorId, 'source');
    try {
      sourceImagePath = await rasterizePdf(pdfPath, outputBase, PDF_RASTER_DPI);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
    // Real-world scale comes from a "<N> MM WIDE" dimension annotation, not the
    // raster DPI (that only yields page-millimetres, off by the drawing's scale
    // factor). No such annotation -> scale unknown -> null (distances in pixels)
    // rather than a fabricated real-world figure.
    const calibration = await calibrateScale(pdfPath, sourceImagePath, PDF_RASTER_DPI);
    pixelToMm = calibration.found ? calibration.pixelToMm : null;
  } else {
    const ext = path.extname(originalName) || '.png';
    sourceImagePath = floorSourcePath(params.floorId, `source${ext}`);
    await fs.writeFile(sourceImagePath, buffer);
    pixelToMm = null;
  }

  config.sourceImagePath = sourceImagePath;
  config.pixelToMm = pixelToMm;
  config.grid = null; // stale until grid is (re)generated against the new source
  config.updatedAt = new Date().toISOString();
  await writeFloorConfig(config);

  return NextResponse.json({ sourceImagePath, pixelToMm });
}
