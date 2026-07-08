'use client';

import { useState } from 'react';
import { ZONE_CATEGORIES, type Zone, type ZoneCategory } from '@/lib/types';

interface Props {
  initial?: Pick<Zone, 'name' | 'category'>;
  onSubmit: (values: { name: string; category: ZoneCategory }) => void;
  onCancel: () => void;
}

export default function ZoneForm({ initial, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState<ZoneCategory>(initial?.category ?? 'Other');

  return (
    <form
      className="space-y-3 border border-border bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit({ name: name.trim(), category });
      }}
    >
      <div>
        <label className="block text-xs font-medium text-ink/70">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full border border-border px-2 py-1.5 text-sm outline-none focus:border-accent"
          placeholder="e.g. Zone A"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink/70">Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ZoneCategory)}
          className="mt-1 w-full border border-border bg-white px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {ZONE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="flex-1 bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
          Save zone
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
