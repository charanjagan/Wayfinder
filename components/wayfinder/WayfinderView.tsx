'use client';

import { useCallback, useEffect, useState } from 'react';
import FloorImageStage, { type NaturalSize } from '../FloorImageStage';
import Breadcrumb from './Breadcrumb';
import Directions from './Directions';
import DirectorySearch, { toDestinations, type Destination } from './DirectorySearch';
import { buildDirections, formatTotalDistance } from '@/lib/directions';
import type { FloorConfig } from '@/lib/types';

interface RouteResult {
  points: { x: number; y: number }[];
  distancePx: number;
}

export default function WayfinderView({
  config,
  floors,
}: {
  config: FloorConfig;
  floors: { id: string; name: string }[];
}) {
  const [natural, setNatural] = useState<NaturalSize | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const destinations = toDestinations(config.zones, config.pois);

  // "You are here" is the kiosk's own fixed spot, placed once by an admin in
  // Setup -- every route starts here. End users only pick a destination.
  const origin = config.origin;

  // A whole-floor workstation zone (its polygon is the entire open region) is
  // meaningless to draw as an outline. Zones are non-interactive outlines only;
  // navigation targets come from the directory or POI markers.
  const imageArea = natural ? natural.width * natural.height : 0;
  function isWholeFloorZone(points: { x: number; y: number }[]): boolean {
    if (!imageArea) return false;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const bboxArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    return bboxArea > 0.6 * imageArea;
  }

  const computeRoute = useCallback(
    async (to: Destination) => {
      setRoute(null);
      setRouteError(null);
      if (!origin) {
        setRouteError('No “You are here” point set for this floor yet. An admin must place it in Setup.');
        return;
      }
      if (!config.grid) {
        setRouteError('This floor has no navigable grid yet.');
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/floors/${config.id}/route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ start: origin, end: to.point }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setRouteError(body.error ?? 'No path found.');
          return;
        }
        setRoute(await res.json());
      } finally {
        setLoading(false);
      }
    },
    [config.id, config.grid, origin],
  );

  useEffect(() => {
    if (destination) computeRoute(destination);
  }, [destination, computeRoute]);

  const directionSteps = route ? buildDirections(route.points, config.pixelToMm) : [];
  const markerR = natural ? Math.max(4, natural.width * 0.004) : 5;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-white px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">Wayfinder — {config.name}</h1>
        </div>
        {floors.length > 1 && (
          <select
            value={config.id}
            onChange={(e) => {
              window.location.href = `/wayfinder/${e.target.value}`;
            }}
            className="border border-border bg-white px-2 py-1 text-xs"
          >
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </header>

      <Breadcrumb destinationName={destination?.name ?? null} />

      <div className="flex min-h-0 flex-1">
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-border bg-white p-4">
          <div className="border border-border bg-surface p-2.5 text-xs">
            <span className="font-medium">You are here</span>
            <p className="mt-1 text-ink/60">
              {origin
                ? 'Pick a destination below to see the route from here.'
                : 'Not set for this floor. An admin must place it in Setup.'}
            </p>
          </div>

          <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink/50">Directory</h2>
          <div className="mt-2">
            <DirectorySearch destinations={destinations} onSelect={setDestination} />
          </div>
        </aside>

        <main className="flex flex-1 flex-col gap-4 overflow-auto bg-surface p-4">
          <FloorImageStage
            floorId={config.id}
            hasImage={!!config.sourceImagePath}
            onNaturalSize={setNatural}
            overlay={() => (
              <>
                {config.zones
                  .filter((z) => !z.hidden && !isWholeFloorZone(z.points))
                  .map((zone) => (
                    <polygon
                      key={zone.id}
                      points={zone.points.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="transparent"
                      stroke="#D8DBDF"
                      strokeWidth={1}
                      style={{ pointerEvents: 'none' }}
                    />
                  ))}

                {config.pois.map((poi) => (
                  <circle
                    key={poi.id}
                    cx={poi.x}
                    cy={poi.y}
                    r={markerR}
                    fill={destination?.id === `poi:${poi.id}` ? '#2954D9' : '#1E2328'}
                    className="cursor-pointer"
                    onClick={() =>
                      setDestination({
                        id: `poi:${poi.id}`,
                        name: poi.name,
                        subtitle: poi.type || 'POI',
                        point: { x: poi.x, y: poi.y },
                      })
                    }
                  />
                ))}

                {route && (
                  <polyline
                    points={route.points.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#2954D9"
                    strokeWidth={natural ? Math.max(2, natural.width * 0.003) : 3}
                    strokeDasharray="10 8"
                    className="animate-flow"
                    style={{ pointerEvents: 'none' }}
                  />
                )}

                {origin && (
                  <g style={{ pointerEvents: 'none' }}>
                    <circle cx={origin.x} cy={origin.y} r={markerR * 1.4} fill="#16A34A" stroke="#ffffff" strokeWidth={1.5} />
                    <text x={origin.x + markerR * 2} y={origin.y + markerR} fontSize={natural ? natural.width * 0.012 : 12} fill="#16A34A">
                      You are here
                    </text>
                  </g>
                )}

                {route && (
                  <circle
                    cx={route.points[route.points.length - 1].x}
                    cy={route.points[route.points.length - 1].y}
                    r={natural ? Math.max(5, natural.width * 0.005) : 6}
                    fill="#2954D9"
                    style={{ pointerEvents: 'none' }}
                  />
                )}
              </>
            )}
          />

          {routeError && <div className="border border-border bg-white p-3 text-sm text-ink/70">{routeError}</div>}
          {loading && <div className="text-sm text-ink/50">Finding route…</div>}
          {route && !loading && (
            <Directions steps={directionSteps} totalLabel={formatTotalDistance(route.distancePx, config.pixelToMm)} />
          )}
          {!route && !loading && !routeError && <Directions steps={[]} totalLabel="" />}
        </main>
      </div>
    </div>
  );
}
