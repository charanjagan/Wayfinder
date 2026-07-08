'use client';

import { useMemo, useState } from 'react';
import type { POI, Zone } from '@/lib/types';

export interface Destination {
  id: string;
  name: string;
  subtitle: string;
  point: { x: number; y: number };
}

export function zoneCentroid(zone: Zone): { x: number; y: number } {
  const sum = zone.points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / zone.points.length, y: sum.y / zone.points.length };
}

export function toDestinations(zones: Zone[], pois: POI[]): Destination[] {
  const zoneDestinations = zones
    .filter((z) => !z.hidden)
    .map((z) => ({ id: `zone:${z.id}`, name: z.name, subtitle: z.category, point: zoneCentroid(z) }));
  const poiDestinations = pois.map((p) => ({
    id: `poi:${p.id}`,
    name: p.name,
    subtitle: p.type || 'POI',
    point: { x: p.x, y: p.y },
  }));
  return [...zoneDestinations, ...poiDestinations];
}

export default function DirectorySearch({
  destinations,
  onSelect,
}: {
  destinations: Destination[];
  onSelect: (destination: Destination) => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return destinations;
    return destinations.filter((d) => d.name.toLowerCase().includes(q) || d.subtitle.toLowerCase().includes(q));
  }, [destinations, query]);

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or category…"
        className="w-full border border-border px-2.5 py-1.5 text-sm outline-none focus:border-accent"
      />
      <ul className="mt-2 max-h-[calc(100vh-220px)] space-y-1 overflow-y-auto">
        {filtered.map((d) => (
          <li key={d.id}>
            <button
              onClick={() => onSelect(d)}
              className="w-full border border-border px-2.5 py-1.5 text-left text-xs hover:border-accent hover:bg-accent/5"
            >
              <div className="font-medium">{d.name}</div>
              <div className="text-ink/50">{d.subtitle}</div>
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="px-2.5 py-2 text-xs text-ink/50">No matches.</li>}
      </ul>
    </div>
  );
}
