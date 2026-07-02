import { notFound } from 'next/navigation';
import SetupEditor from '@/components/setup/SetupEditor';
import { planExists, readGraph } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function SetupPage({ params }: { params: { id: string } }) {
  const exists = await planExists(params.id);
  if (!exists) notFound();

  const graph = await readGraph(params.id);

  return <SetupEditor planId={params.id} initialGraph={graph} imageUrl={`/api/floorplans/${params.id}/image`} />;
}
