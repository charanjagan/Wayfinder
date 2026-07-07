import { NextRequest } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/adminAuth';
import { newId } from '@/lib/id';
import { runIngestPipeline } from '@/lib/pipeline';
import {
  deleteFloorPlan,
  ensureDataDir,
  floorPlanDir,
  getCurrentFloorplanId,
  occupancyGridPath,
  setCurrentFloorplanId,
  sourcePdfPath,
  writeGraph,
} from '@/lib/storage';
import type { Graph } from '@/lib/types';

export async function POST(request: NextRequest) {
  await ensureDataDir();

  // First upload is public (the whole point of the /upload gate). Once a floor plan is
  // active, replacing it is an admin-only action -- reachable only from the admin menu.
  const previousId = await getCurrentFloorplanId();
  if (previousId) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = token ? await verifySessionToken(token) : null;
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File) || path.extname(file.name).toLowerCase() !== '.pdf') {
    return new Response(JSON.stringify({ error: 'Upload a PDF file.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const id = newId('plan');
  const dir = floorPlanDir(id);
  await fs.mkdir(dir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(sourcePdfPath(id), buffer);

  const displayName = path.basename(file.name, path.extname(file.name));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        for await (const event of runIngestPipeline(sourcePdfPath(id), dir)) {
          if (event.stage === 'error') {
            throw new Error(event.message ?? 'Ingestion failed.');
          }
          if (event.stage === 'done') {
            const occupancyRaw = await fs.readFile(occupancyGridPath(id), 'utf-8');
            const occupancy = JSON.parse(occupancyRaw) as { sourcePixelWidth: number; sourcePixelHeight: number };

            // Zones come from the ingestion pipeline's own contour detection (zones.json,
            // already written by runIngestPipeline). "You Are Here" is placed later by an
            // admin in the setup editor -- there's no auto-detected candidate for it.
            const graph: Graph = {
              floorPlan: {
                id,
                name: displayName,
                createdAt: new Date().toISOString(),
                imageWidth: occupancy.sourcePixelWidth,
                imageHeight: occupancy.sourcePixelHeight,
              },
              youAreHere: null,
            };
            await writeGraph(id, graph);
            await setCurrentFloorplanId(id);
            if (previousId && previousId !== id) {
              await deleteFloorPlan(previousId);
            }
            send({ stage: 'done', id });
          } else {
            send(event);
          }
        }
      } catch (err) {
        await deleteFloorPlan(id);
        send({ stage: 'error', message: err instanceof Error ? err.message : 'Ingestion failed.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}
