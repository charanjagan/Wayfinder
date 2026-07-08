import { readFloorConfig, listFloors } from '@/lib/storage';
import WayfinderView from '@/components/wayfinder/WayfinderView';

export default async function WayfinderPage({ params }: { params: { floorId: string } }) {
  const config = await readFloorConfig(params.floorId);
  if (!config) {
    return <main className="p-8">Floor not found: {params.floorId}</main>;
  }

  const floorIds = await listFloors();
  const floors = await Promise.all(
    floorIds.map(async (id) => {
      const c = await readFloorConfig(id);
      return { id, name: c?.name ?? id };
    }),
  );

  return <WayfinderView config={config} floors={floors} />;
}
