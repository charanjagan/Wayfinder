import { notFound } from 'next/navigation';
import WayfinderView from '@/components/wayfinder/WayfinderView';
import { planExists, readGraph } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function WayfinderPage({ params }: { params: { id: string } }) {
  const exists = await planExists(params.id);
  if (!exists) notFound();

  const graph = await readGraph(params.id);

  return <WayfinderView graph={graph} imageUrl={`/api/floorplans/${params.id}/image`} editHref={`/plan/${params.id}/setup`} />;
}
