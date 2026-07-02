import { NextRequest, NextResponse } from 'next/server';
import { planExists, readGraph, writeGraph } from '@/lib/storage';
import type { Graph } from '@/lib/types';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const exists = await planExists(params.id);
  if (!exists) {
    return NextResponse.json({ error: 'Floor plan not found.' }, { status: 404 });
  }
  const graph = await readGraph(params.id);
  return NextResponse.json(graph);
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const exists = await planExists(params.id);
  if (!exists) {
    return NextResponse.json({ error: 'Floor plan not found.' }, { status: 404 });
  }

  const body = (await request.json()) as Graph;
  if (!body?.floorPlan || !Array.isArray(body.waypoints) || !Array.isArray(body.edges) || !Array.isArray(body.pois)) {
    return NextResponse.json({ error: 'Invalid graph payload.' }, { status: 400 });
  }

  await writeGraph(params.id, body);
  return NextResponse.json({ ok: true });
}
