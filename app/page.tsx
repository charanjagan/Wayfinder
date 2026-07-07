import { redirect } from 'next/navigation';
import WayfinderView from '@/components/wayfinder/WayfinderView';
import { filterVisible } from '@/lib/graph';
import { getCurrentFloorplanId, readGraph, readZones } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const id = await getCurrentFloorplanId();
  if (!id) redirect('/upload');

  const graph = await readGraph(id);
  const zones = await readZones(id);
  const visibleZones = filterVisible(zones);

  return (
    <WayfinderView
      graph={graph}
      zones={visibleZones}
      imageUrl={`/api/floorplans/${id}/image`}
      gridUrl={`/api/floorplans/${id}/grid`}
    />
  );
}
