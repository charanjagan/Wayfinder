'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FloorPlanSummary } from '@/lib/types';

export default function PlanPicker({ plans }: { plans: FloorPlanSummary[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm('Delete this floor plan? This removes it permanently.')) return;
    setDeletingId(id);
    try {
      await fetch(`/api/floorplans/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plans.map((plan) => (
        <div key={plan.id} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <Link href={`/plan/${plan.id}`} className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={plan.thumbnail} alt={plan.name} className="h-36 w-full object-cover bg-slate-100" />
            <div className="p-3">
              <p className="truncate font-medium text-slate-800">{plan.name}</p>
              <p className="text-xs text-slate-500">{new Date(plan.createdAt).toLocaleDateString()}</p>
            </div>
          </Link>
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs">
            <Link href={`/plan/${plan.id}/setup`} className="text-indigo-600 hover:underline">
              Edit
            </Link>
            <button
              onClick={() => handleDelete(plan.id)}
              disabled={deletingId === plan.id}
              className="text-red-500 hover:underline disabled:opacity-50"
            >
              {deletingId === plan.id ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
