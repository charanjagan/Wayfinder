import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/adminAuth';
import { clearCurrentFloorplanId, deleteFloorPlan, getCurrentFloorplanId } from '@/lib/storage';

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const id = await getCurrentFloorplanId();
  if (!id) {
    return NextResponse.json({ error: 'No active floor plan.' }, { status: 404 });
  }

  await deleteFloorPlan(id);
  await clearCurrentFloorplanId();
  return NextResponse.json({ ok: true });
}
