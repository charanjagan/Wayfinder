import Link from 'next/link';
import FloorPlanPanel from '@/components/admin/FloorPlanPanel';
import LogoutButton from '@/components/admin/LogoutButton';
import { getCurrentFloorplanId, readGraph } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function AdminHomePage() {
  const id = await getCurrentFloorplanId();
  const graph = id ? await readGraph(id) : null;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Admin menu</h1>
        <div className="flex items-center gap-4">
          <LogoutButton />
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-700 hover:underline">
            ← Home
          </Link>
        </div>
      </div>
      <FloorPlanPanel
        floorplan={graph?.floorPlan ?? null}
        imageUrl={id ? `/api/floorplans/${id}/image` : null}
        editPlanHref={id ? '/admin/setup' : undefined}
      />
    </main>
  );
}
