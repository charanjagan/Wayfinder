import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { readFloorConfig, writeFloorConfig, createEmptyFloorConfig } from '@/lib/storage';
import SetupEditor from '@/components/setup/SetupEditor';

export default async function SetupPage({ params }: { params: { floorId: string } }) {
  if (params.floorId === 'new') {
    const id = randomUUID();
    await writeFloorConfig(createEmptyFloorConfig(id, 'Untitled floor'));
    redirect(`/setup/${id}`);
  }

  const config = await readFloorConfig(params.floorId);
  if (!config) {
    return <main className="p-8">Floor not found: {params.floorId}</main>;
  }

  return <SetupEditor initialConfig={config} />;
}
