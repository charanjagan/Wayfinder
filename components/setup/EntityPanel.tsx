'use client';

import type { Graph, POI, Waypoint } from '@/lib/types';

const CATEGORY_LABEL: Record<POI['category'], string> = {
  zone: 'Zone',
  room: 'Room',
  facility: 'Facility',
};

export default function EntityPanel({
  graph,
  onFocus,
  onDeleteWaypoint,
  onDeletePoi,
  onEditPoi,
}: {
  graph: Graph;
  onFocus: (x: number, y: number) => void;
  onDeleteWaypoint: (wp: Waypoint) => void;
  onDeletePoi: (poi: POI) => void;
  onEditPoi: (poi: POI) => void;
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">POIs ({graph.pois.length})</h2>
        <ul className="mt-2 space-y-1.5">
          {graph.pois.map((poi) => (
            <li key={poi.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
              <button onClick={() => onEditPoi(poi)} className="min-w-0 flex-1 truncate text-left text-slate-700">
                {poi.name}
                <span className="ml-1.5 text-xs text-slate-400">{CATEGORY_LABEL[poi.category]}</span>
              </button>
              <div className="flex shrink-0 items-center gap-1.5 text-xs">
                <button onClick={() => onFocus(poi.x, poi.y)} className="text-indigo-500 hover:underline">
                  Focus
                </button>
                <button onClick={() => onDeletePoi(poi)} className="text-red-500 hover:underline">
                  Delete
                </button>
              </div>
            </li>
          ))}
          {graph.pois.length === 0 && <li className="px-2 py-1 text-xs text-slate-400">No POIs placed yet.</li>}
        </ul>
      </div>

      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">Waypoints ({graph.waypoints.length})</h2>
        <ul className="mt-2 space-y-1.5">
          {graph.waypoints.map((wp) => (
            <li key={wp.id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
              <span className="truncate text-slate-500">
                {Math.round(wp.x)}, {Math.round(wp.y)}
              </span>
              <div className="flex shrink-0 items-center gap-1.5 text-xs">
                <button onClick={() => onFocus(wp.x, wp.y)} className="text-indigo-500 hover:underline">
                  Focus
                </button>
                <button onClick={() => onDeleteWaypoint(wp)} className="text-red-500 hover:underline">
                  Delete
                </button>
              </div>
            </li>
          ))}
          {graph.waypoints.length === 0 && <li className="px-2 py-1 text-xs text-slate-400">No waypoints placed yet.</li>}
        </ul>
      </div>
    </aside>
  );
}
