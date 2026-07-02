'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { routeBetweenPois } from '@/lib/graph';
import type { Graph, POI } from '@/lib/types';
import Legend from './Legend';
import SearchBar from './SearchBar';

const CATEGORY_FILL: Record<POI['category'], string> = {
  zone: '#6366f1',
  room: '#059669',
  facility: '#d97706',
};

const PIXELS_PER_METER = 20; // rough default; accurate scale requires the "set scale" calibration step
const WALK_SPEED_M_PER_S = 1.4;

function formatDistance(distancePx: number): string {
  const meters = distancePx / PIXELS_PER_METER;
  const seconds = meters / WALK_SPEED_M_PER_S;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `~${Math.round(meters)} m · ~${minutes} min`;
}

export default function WayfinderView({
  graph,
  imageUrl,
  editHref,
  onExitPreview,
}: {
  graph: Graph;
  imageUrl: string;
  editHref?: string;
  onExitPreview?: () => void;
}) {
  const defaultEntrance = graph.pois.find((p) => p.isEntrance) ?? graph.pois[0] ?? null;
  const [startId, setStartId] = useState<string | null>(null);
  const [endId, setEndId] = useState<string | null>(null);

  const route = useMemo(() => {
    if (!startId || !endId) return null;
    return routeBetweenPois(graph, startId, endId);
  }, [graph, startId, endId]);

  function handlePinClick(poi: POI) {
    if (!startId || (startId && endId)) {
      setStartId(poi.id);
      setEndId(null);
      return;
    }
    if (poi.id === startId) return;
    setEndId(poi.id);
  }

  function handleSearchSelect(poi: POI) {
    setEndId(poi.id);
    if (!startId) {
      setStartId(defaultEntrance?.id ?? poi.id);
    }
  }

  function clearRoute() {
    setStartId(null);
    setEndId(null);
  }

  const radius = Math.max(6, graph.floorPlan.imageWidth / 140);
  const pathString = route?.points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <div className="flex flex-col gap-2 border-b border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex-1">
          <SearchBar pois={graph.pois} onSelect={handleSearchSelect} />
        </div>
        <div className="flex items-center justify-between gap-3 text-sm sm:justify-end">
          {route && <span className="whitespace-nowrap text-slate-600">{formatDistance(route.distance)}</span>}
          {(startId || endId) && (
            <button onClick={clearRoute} className="rounded-full border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50">
              Clear route
            </button>
          )}
          {editHref && (
            <Link href={editHref} className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
              Edit plan
            </Link>
          )}
          {onExitPreview && (
            <button onClick={onExitPreview} className="rounded-full bg-slate-800 px-3 py-1.5 text-white hover:bg-slate-700">
              Back to editing
            </button>
          )}
        </div>
      </div>

      <div className="relative flex-1 touch-pan-x touch-pan-y overflow-auto">
        <div className="relative mx-auto max-w-4xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={graph.floorPlan.name} className="block w-full select-none" draggable={false} />
          <svg
            viewBox={`0 0 ${graph.floorPlan.imageWidth} ${graph.floorPlan.imageHeight}`}
            className="absolute inset-0 h-full w-full"
          >
            {pathString && (
              <polyline
                points={pathString}
                fill="none"
                stroke="#4338ca"
                strokeWidth={Math.max(3, graph.floorPlan.imageWidth / 250)}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="14 10"
                className="animate-dash"
              />
            )}
            {graph.pois.map((poi) => {
              const isStart = poi.id === startId;
              const isEnd = poi.id === endId;
              return (
                <g
                  key={poi.id}
                  onClick={() => handlePinClick(poi)}
                  className="cursor-pointer"
                  transform={`translate(${poi.x} ${poi.y})`}
                >
                  {(isStart || isEnd) && (
                    <circle r={radius + 5} fill="none" stroke={isStart ? '#10b981' : '#ef4444'} strokeWidth={3} />
                  )}
                  <circle r={radius} fill={CATEGORY_FILL[poi.category]} stroke="white" strokeWidth={2} />
                  <text
                    y={-radius - 6}
                    textAnchor="middle"
                    fontSize={Math.max(11, graph.floorPlan.imageWidth / 130)}
                    fill="#1e293b"
                    stroke="white"
                    strokeWidth={3}
                    paintOrder="stroke"
                    className="pointer-events-none select-none font-medium"
                  >
                    {poi.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <Legend />
    </div>
  );
}
