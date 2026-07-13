import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { readFloorConfig, writeFloorConfig, createEmptyFloorConfig, listFloors } from '@/lib/storage';
import { requireAdminPage } from '@/lib/adminAuth';
import SetupEditor from '@/components/setup/SetupEditor';

export const dynamic = 'force-dynamic';

export default async function SetupPage({ params }: { params: { floorId: string } }) {
  await requireAdminPage();

  if (params.floorId === 'new') {
    // Single-floor app: reuse the one floor that already exists rather than
    // spawning a second one every time an admin lands here.
    const existingIds = await listFloors();
    if (existingIds.length > 0) {
      redirect(`/setup/${existingIds[0]}`);
    }
    const id = randomUUID();
    await writeFloorConfig(createEmptyFloorConfig(id, 'Floor Plan'));
    redirect(`/setup/${id}`);
  }

  const config = await readFloorConfig(params.floorId);
  if (!config) {
    return <main className="p-8">Floor not found: {params.floorId}</main>;
  }

  return <SetupEditor initialConfig={config} />;
}
