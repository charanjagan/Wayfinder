import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { floorPlanDir, labelsPath, zonesPath, planExists } from '@/lib/storage';

interface Label {
  id: string;
  text: string;
  type: string;
  x: number;
  y: number;
  associatedZone: string | null;
}

interface Zone {
  id: string;
  name: string;
  points: number[][];
  hidden: boolean;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const exists = await planExists(params.id);
  if (!exists) {
    return NextResponse.json({ error: 'Floor plan not found.' }, { status: 404 });
  }

  const [labelsRaw, zonesRaw, diagnosticsRaw] = await Promise.all([
    fs.readFile(labelsPath(params.id), 'utf-8').catch(() => '[]'),
    fs.readFile(zonesPath(params.id), 'utf-8').catch(() => '[]'),
    fs
      .readFile(path.join(floorPlanDir(params.id), 'debug', 'diagnostics.json'), 'utf-8')
      .catch(() => null),
  ]);

  const labels = JSON.parse(labelsRaw) as Label[];
  const zones = JSON.parse(zonesRaw) as Zone[];
  const diagnostics = diagnosticsRaw ? JSON.parse(diagnosticsRaw) : null;

  return NextResponse.json({
    rawTextObjectCount: diagnostics?.rawTextObjectCount ?? null,
    labelSpanCount: diagnostics?.labelSpanCount ?? labels.length,
    labelTypeCounts: diagnostics?.labelTypeCounts ?? null,
    sampleLabels: labels.slice(0, 30),
    zoneCount: zones.length,
    zones: zones.map((z) => ({ id: z.id, name: z.name, hidden: z.hidden, points: z.points })),
    debugImages: {
      threshold: `/api/floorplans/${params.id}/debug/threshold.png`,
      gridPreview: `/api/floorplans/${params.id}/debug/grid_preview.png`,
      zonesOverlay: `/api/floorplans/${params.id}/debug/zones_overlay.png`,
    },
  });
}
