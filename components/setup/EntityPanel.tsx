'use client';

import type { Zone } from '@/lib/types';

export default function EntityPanel({
  zones,
  selectedZoneId,
  youAreHere,
  onFocus,
  onFocusZone,
  onRenameZone,
  onToggleZoneHidden,
  onDeleteZone,
  onClearYouAreHere,
}: {
  zones: Zone[];
  selectedZoneId: string | null;
  youAreHere: { x: number; y: number } | null;
  onFocus: (x: number, y: number) => void;
  onFocusZone: (zone: Zone) => void;
  onRenameZone: (zoneId: string, name: string) => void;
  onToggleZoneHidden: (zoneId: string) => void;
  onDeleteZone: (zoneId: string) => void;
  onClearYouAreHere: () => void;
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">You Are Here</h2>
        {youAreHere ? (
          <div className="mt-2 flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
            <span className="truncate text-slate-500">
              {Math.round(youAreHere.x)}, {Math.round(youAreHere.y)}
            </span>
            <div className="flex shrink-0 items-center gap-1.5 text-xs">
              <button onClick={() => onFocus(youAreHere.x, youAreHere.y)} className="text-indigo-500 hover:underline">
                Focus
              </button>
              <button onClick={onClearYouAreHere} className="text-red-500 hover:underline">
                Clear
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-2 px-2 py-1 text-xs text-slate-400">
            Not set. Use the &quot;You Are Here&quot; tool and click the map.
          </p>
        )}
      </div>

      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">Zones ({zones.length})</h2>
        <p className="mt-1 text-xs text-slate-400">Use the Zone tool: drag on the map to draw, drag a corner to reshape.</p>
        <ul className="mt-2 space-y-1.5">
          {zones.map((zone) => (
            <li
              key={zone.id}
              className={`rounded-md px-2 py-1.5 text-sm ${zone.id === selectedZoneId ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-1.5">
                <input
                  value={zone.name}
                  onChange={(e) => onRenameZone(zone.id, e.target.value)}
                  onFocus={() => onFocusZone(zone)}
                  className="min-w-0 flex-1 truncate border-b border-transparent bg-transparent text-slate-700 focus:border-indigo-300 focus:outline-none"
                />
              </div>
              <div className="mt-1 flex shrink-0 items-center gap-2 text-xs">
                <button onClick={() => onFocusZone(zone)} className="text-indigo-500 hover:underline">
                  Focus
                </button>
                <button onClick={() => onToggleZoneHidden(zone.id)} className="text-slate-500 hover:underline">
                  {zone.hidden ? 'Unhide' : 'Hide'}
                </button>
                <button onClick={() => onDeleteZone(zone.id)} className="text-red-500 hover:underline">
                  Delete
                </button>
              </div>
            </li>
          ))}
          {zones.length === 0 && <li className="px-2 py-1 text-xs text-slate-400">No zones yet.</li>}
        </ul>
      </div>
    </aside>
  );
}
