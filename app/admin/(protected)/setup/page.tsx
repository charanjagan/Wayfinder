import { redirect } from 'next/navigation';
import SetupEditor from '@/components/setup/SetupEditor';
import { getCurrentFloorplanId, readGraph, readZones } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const id = await getCurrentFloorplanId();
  if (!id) redirect('/upload');

  const graph = await readGraph(id);
  const zones = await readZones(id);

  return (
    <SetupEditor planId={id} initialGraph={graph} initialZones={zones} imageUrl={`/api/floorplans/${id}/image`} />
  );
}
