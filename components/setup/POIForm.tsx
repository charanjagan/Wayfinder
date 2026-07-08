'use client';

import { useState } from 'react';
import type { POI, Zone } from '@/lib/types';

interface Props {
  zones: Zone[];
  initial?: Pick<POI, 'name' | 'type' | 'zoneId'>;
  onSubmit: (values: { name: string; type: string; zoneId: string | null }) => void;
  onCancel: () => void;
}

export default function POIForm({ zones, initial, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? '');
  const [zoneId, setZoneId] = useState<string>(initial?.zoneId ?? '');

  return (
    <form
      className="space-y-3 border border-border bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit({ name: name.trim(), type: type.trim(), zoneId: zoneId || null });
      }}
    >
      <div>
        <label className="block text-xs font-medium text-ink/70">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full border border-border px-2 py-1.5 text-sm outline-none focus:border-accent"
          placeholder="e.g. Reception desk"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink/70">Type (optional)</label>
        <input
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="mt-1 w-full border border-border px-2 py-1.5 text-sm outline-none focus:border-accent"
          placeholder="e.g. Printer, Desk, Restroom"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink/70">Zone (optional)</label>
        <select
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
          className="mt-1 w-full border border-border bg-white px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          <option value="">No zone</option>
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="flex-1 bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
          Save POI
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-border px-3 py-1.5 text-sm hover:bg-surface"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
