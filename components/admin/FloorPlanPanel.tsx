'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import UploadCard from '@/components/UploadCard';
import type { FloorPlan } from '@/lib/types';

export default function FloorPlanPanel({
  floorplan,
  imageUrl,
  editPlanHref,
}: {
  floorplan: FloorPlan | null;
  imageUrl: string | null;
  editPlanHref?: string;
}) {
  const router = useRouter();
  const [showReplace, setShowReplace] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirm('Delete the current floor plan? This removes all its data and cannot be undone.')) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/floorplan', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Delete failed.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase text-slate-400">Floor plan</h2>

      {floorplan && imageUrl ? (
        <div className="mb-4 flex items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={floorplan.name} className="h-24 w-32 rounded-lg border border-slate-200 object-cover" />
          <div>
            <p className="font-medium text-slate-800">{floorplan.name}</p>
            <p className="text-sm text-slate-500">
              {floorplan.imageWidth}×{floorplan.imageHeight}px · uploaded {new Date(floorplan.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-500">No active floor plan.</p>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        {floorplan && editPlanHref && (
          <Link
            href={editPlanHref}
            className="rounded-full bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
          >
            Edit plan
          </Link>
        )}
        <button
          onClick={() => setShowReplace((v) => !v)}
          className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          {floorplan ? 'Replace floor plan' : 'Upload floor plan'}
        </button>
        {floorplan && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-full border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete floor plan'}
          </button>
        )}
      </div>

      {showReplace && (
        <div className="mt-4">
          <UploadCard redirectTo="/admin" />
        </div>
      )}
    </section>
  );
}
