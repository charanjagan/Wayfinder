'use client';

import { useMemo, useState } from 'react';
import { searchPois } from '@/lib/search';
import type { POI } from '@/lib/types';

const CATEGORY_LABEL: Record<POI['category'], string> = {
  zone: 'Zone',
  room: 'Room',
  facility: 'Facility',
};

export default function SearchBar({ pois, onSelect }: { pois: POI[]; onSelect: (poi: POI) => void }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const results = useMemo(() => searchPois(pois, query).slice(0, 8), [pois, query]);

  return (
    <div className="relative w-full">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Search rooms, desks, facilities…"
        className="w-full rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
      {focused && query.trim() && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">No matches.</p>
          ) : (
            results.map((poi) => (
              <button
                key={poi.id}
                onMouseDown={() => {
                  onSelect(poi);
                  setQuery('');
                }}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-700">{poi.name}</span>
                <span className="text-xs uppercase tracking-wide text-slate-400">{CATEGORY_LABEL[poi.category]}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
