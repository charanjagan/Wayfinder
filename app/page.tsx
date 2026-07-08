import Link from 'next/link';
import { listFloors, readFloorConfig } from '@/lib/storage';

export default async function HomePage() {
  const floorIds = await listFloors();
  const floors = await Promise.all(
    floorIds.map(async (id) => {
      const config = await readFloorConfig(id);
      return { id, name: config?.name ?? id };
    }),
  );

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Wayfinder</h1>
      <p className="mt-2 text-ink/60">Pick a floor and a mode to continue.</p>

      <div className="mt-6 space-y-2">
        {floors.length === 0 && <p className="text-sm text-ink/50">No floors yet. Create one below.</p>}
        {floors.map((floor) => (
          <div key={floor.id} className="flex items-center justify-between border border-border bg-white p-3">
            <span className="text-sm font-medium">{floor.name}</span>
            <div className="space-x-4 text-sm">
              <Link className="text-accent hover:underline" href={`/setup/${floor.id}`}>
                Setup
              </Link>
              <Link className="text-accent hover:underline" href={`/wayfinder/${floor.id}`}>
                Wayfinder
              </Link>
            </div>
          </div>
        ))}
      </div>

      <Link
        className="mt-6 inline-block border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface"
        href="/setup/new"
      >
        + New floor
      </Link>
    </main>
  );
}
