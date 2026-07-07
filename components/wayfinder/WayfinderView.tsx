'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { routeToZone } from '@/lib/graph';
import type { OccupancyGrid } from '@/lib/pathfinding';
import type { Graph, Zone } from '@/lib/types';
import Legend from './Legend';

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
  zones,
  imageUrl,
  gridUrl,
  onExitPreview,
}: {
  graph: Graph;
  zones: Zone[];
  imageUrl: string;
  gridUrl?: string;
  onExitPreview?: () => void;
}) {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [showZoneList, setShowZoneList] = useState(false);
  const [zoneFilter, setZoneFilter] = useState('');
  const [occupancyGrid, setOccupancyGrid] = useState<OccupancyGrid | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);

  useEffect(() => {
    if (!gridUrl) return;
    let cancelled = false;
    fetch(gridUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setOccupancyGrid(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gridUrl]);

  const selectedZone = useMemo(() => zones.find((z) => z.id === selectedZoneId) ?? null, [zones, selectedZoneId]);

  const route = useMemo(() => {
    if (!selectedZone || !graph.youAreHere) return null;
    return routeToZone(graph.youAreHere, selectedZone, occupancyGrid ?? undefined);
  }, [selectedZone, graph.youAreHere, occupancyGrid]);

  const sortedZones = useMemo(
    () =>
      [...zones]
        .filter((z) => z.name.toLowerCase().includes(zoneFilter.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [zones, zoneFilter],
  );

  function handleZoneClick(zone: Zone) {
    setSelectedZoneId((current) => (current === zone.id ? null : zone.id));
  }

  function handleZoneSelect(zone: Zone) {
    setSelectedZoneId(zone.id);
    setShowZoneList(false);
  }

  function clearRoute() {
    setSelectedZoneId(null);
  }

  const hereRadius = Math.max(8, graph.floorPlan.imageWidth / 120);
  const pathString = route?.points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className="relative flex h-screen flex-col bg-slate-100">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white p-3">
        <h1 className="min-w-0 truncate text-sm font-semibold text-slate-700">
          {selectedZone ? `To: ${selectedZone.name}` : 'Pick a destination'}
        </h1>
        <div className="flex flex-shrink-0 items-center gap-2 text-sm">
          {route && <span className="whitespace-nowrap text-slate-600">{formatDistance(route.distance)}</span>}
          {selectedZone && (
            <button onClick={clearRoute} className="rounded-full border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50">
              Clear
            </button>
          )}
          <button
            onClick={() => setShowZoneList((v) => !v)}
            className="rounded-full border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
          >
            Zones
          </button>
          <button
            onClick={() => transformRef.current?.resetTransform()}
            className="rounded-full border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
          >
            Reset zoom
          </button>
          <Link href="/admin" className="text-xs text-slate-400 hover:text-slate-600 hover:underline">
            Admin
          </Link>
          {onExitPreview && (
            <button onClick={onExitPreview} className="rounded-full bg-slate-800 px-3 py-1.5 text-white hover:bg-slate-700">
              Back to editing
            </button>
          )}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <TransformWrapper ref={transformRef} minScale={1} maxScale={8} centerOnInit doubleClick={{ disabled: true }}>
          <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full">
            <div className="relative mx-auto max-w-4xl" style={{ willChange: 'transform' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={graph.floorPlan.name} className="block w-full select-none" draggable={false} />
              <svg
                viewBox={`0 0 ${graph.floorPlan.imageWidth} ${graph.floorPlan.imageHeight}`}
                className="absolute inset-0 h-full w-full"
              >
                {zones.map((zone) => {
                  const isSelected = zone.id === selectedZoneId;
                  const centroid = zone.points.reduce(
                    (acc, [x, y]) => ({ x: acc.x + x / zone.points.length, y: acc.y + y / zone.points.length }),
                    { x: 0, y: 0 },
                  );
                  return (
                    <g key={zone.id}>
                      <polygon
                        points={zone.points.map(([x, y]) => `${x},${y}`).join(' ')}
                        fill={isSelected ? 'rgba(67,56,202,0.35)' : 'rgba(99,102,241,0.15)'}
                        stroke={isSelected ? '#4338ca' : '#6366f1'}
                        strokeWidth={isSelected ? 4 : 2}
                        className="cursor-pointer"
                        onClick={() => handleZoneClick(zone)}
                      />
                      <text
                        x={centroid.x}
                        y={centroid.y}
                        textAnchor="middle"
                        fontSize={Math.max(12, graph.floorPlan.imageWidth / 160)}
                        fill="#1e293b"
                        stroke="white"
                        strokeWidth={3}
                        paintOrder="stroke"
                        className="pointer-events-none select-none font-medium"
                      >
                        {zone.name}
                      </text>
                    </g>
                  );
                })}
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
                {graph.youAreHere && (
                  <g transform={`translate(${graph.youAreHere.x} ${graph.youAreHere.y})`}>
                    <circle r={hereRadius} fill="#0ea5e9" stroke="white" strokeWidth={3} />
                    <text
                      y={-hereRadius - 6}
                      textAnchor="middle"
                      fontSize={Math.max(11, graph.floorPlan.imageWidth / 130)}
                      fill="#1e293b"
                      stroke="white"
                      strokeWidth={3}
                      paintOrder="stroke"
                      className="pointer-events-none select-none font-medium"
                    >
                      You Are Here
                    </text>
                  </g>
                )}
              </svg>
            </div>
          </TransformComponent>
        </TransformWrapper>
      </div>

      {showZoneList && (
        <div className="absolute right-3 top-16 z-10 flex max-h-[70vh] w-64 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="p-2">
            <input
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              placeholder="Filter zones…"
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div className="overflow-y-auto px-2 pb-2">
            {sortedZones.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-400">No matches.</p>
            ) : (
              sortedZones.map((zone) => (
                <button
                  key={zone.id}
                  onClick={() => handleZoneSelect(zone)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${
                    zone.id === selectedZoneId ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'
                  }`}
                >
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-zone" />
                  {zone.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <Legend />
    </div>
  );
}
