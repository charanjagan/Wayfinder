import Link from 'next/link';
import { listFloors, readFloorConfig } from '@/lib/storage';

export const dynamic = 'force-dynamic';

// Single-floor app: no picker (there's only ever one floor), but "/" still
// lands on a small menu with both modes -- Setup requires admin login and
// redirects there on its own if you're not signed in.
export default async function HomePage() {
  const floorIds = await listFloors();
  if (floorIds.length === 0) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Wayfinder</h1>
        <p className="mt-2 text-ink/60">No floor plan has been set up yet.</p>
        <Link
          className="mt-6 inline-block border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface"
          href="/admin/login"
        >
          Admin login →
        </Link>
      </main>
    );
  }

  const floorId = floorIds[0];
  const config = await readFloorConfig(floorId);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Wayfinder</h1>
      <p className="mt-2 text-ink/60">{config?.name ?? 'Floor Plan'}</p>

      <div className="mt-6 flex gap-3">
        <Link
          className="border border-border px-4 py-2 text-sm font-medium hover:bg-surface"
          href={`/setup/${floorId}`}
        >
          Setup →
        </Link>
        <Link
          className="border border-border px-4 py-2 text-sm font-medium hover:bg-surface"
          href={`/wayfinder/${floorId}`}
        >
          Wayfinder →
        </Link>
      </div>
    </main>
  );
}
