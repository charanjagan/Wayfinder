import { NextResponse } from 'next/server';
import { deleteFloorPlan, planExists } from '@/lib/storage';

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const exists = await planExists(params.id);
  if (!exists) {
    return NextResponse.json({ error: 'Floor plan not found.' }, { status: 404 });
  }
  await deleteFloorPlan(params.id);
  return NextResponse.json({ ok: true });
}
