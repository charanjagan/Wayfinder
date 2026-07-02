'use client';

import { distance } from '@/lib/graph';
import type { Category, Waypoint } from '@/lib/types';
import type { DraftPoi } from './SetupEditor';

const CATEGORIES: Category[] = ['zone', 'room', 'facility'];

export default function POIForm({
  draft,
  waypoints,
  isEditing,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: DraftPoi;
  waypoints: Waypoint[];
  isEditing: boolean;
  onChange: (patch: Partial<DraftPoi>) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const sortedWaypoints = [...waypoints].sort((a, b) => distance(a, draft) - distance(b, draft));

  return (
    <div className="fixed bottom-4 right-[19rem] z-30 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{isEditing ? 'Edit POI' : 'New POI'}</h3>

      <label className="mb-2 block text-xs font-medium text-slate-500">
        Name
        <input
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          autoFocus
          className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>

      <label className="mb-2 block text-xs font-medium text-slate-500">
        Category
        <select
          value={draft.category}
          onChange={(e) => onChange({ category: e.target.value as Category })}
          className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-2 block text-xs font-medium text-slate-500">
        Aliases (comma-separated)
        <input
          value={draft.aliases}
          onChange={(e) => onChange({ aliases: e.target.value })}
          placeholder="e.g. WS-101 to WS-120"
          className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>

      <label className="mb-2 block text-xs font-medium text-slate-500">
        Nearest waypoint
        <select
          value={draft.nearestWaypoint}
          onChange={(e) => onChange({ nearestWaypoint: e.target.value })}
          className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          <option value="">— none —</option>
          {sortedWaypoints.map((wp) => (
            <option key={wp.id} value={wp.id}>
              {Math.round(wp.x)}, {Math.round(wp.y)} ({Math.round(distance(wp, draft))}px)
            </option>
          ))}
        </select>
      </label>

      <label className="mb-3 flex items-center gap-2 text-xs font-medium text-slate-500">
        <input type="checkbox" checked={draft.isEntrance} onChange={(e) => onChange({ isEntrance: e.target.checked })} />
        Main entrance / default start
      </label>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={onSave} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
            Save
          </button>
          <button onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
        </div>
        {isEditing && onDelete && (
          <button onClick={onDelete} className="text-sm text-red-500 hover:underline">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
