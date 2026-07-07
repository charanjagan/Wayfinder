import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/adminAuth';
import { planExists, readZones, writeZones } from '@/lib/storage';
import type { Zone } from '@/lib/types';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const exists = await planExists(params.id);
  if (!exists) {
    return NextResponse.json({ error: 'Floor plan not found.' }, { status: 404 });
  }
  const zones = await readZones(params.id);
  return NextResponse.json({ zones });
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const exists = await planExists(params.id);
  if (!exists) {
    return NextResponse.json({ error: 'Floor plan not found.' }, { status: 404 });
  }

  const body = (await request.json()) as { zones?: Zone[] };
  if (!Array.isArray(body.zones)) {
    return NextResponse.json({ error: 'Invalid zones payload.' }, { status: 400 });
  }

  await writeZones(params.id, body.zones);
  return NextResponse.json({ ok: true });
}
