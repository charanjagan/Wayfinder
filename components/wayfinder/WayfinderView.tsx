'use client';

import { useState } from 'react';
import Link from 'next/link';
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

const ORIGIN_NAME_HINT = /entrance|lobby|reception|kiosk/i;

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

  // No check-in/beacon system exists yet, so "you are here" is approximated as a
  // named entrance/lobby/reception POI if the floor has one, else the image center.
  function originPoint(): { x: number; y: number } {
    const hinted = config.pois.find((p) => ORIGIN_NAME_HINT.test(p.name) || ORIGIN_NAME_HINT.test(p.type));
    if (hinted) return { x: hinted.x, y: hinted.y };
    return { x: (natural?.width ?? 0) / 2, y: (natural?.height ?? 0) / 2 };
  }

  async function navigateTo(dest: Destination) {
    setDestination(dest);
    setRoute(null);
    setRouteError(null);
    if (!config.grid) {
      setRouteError('This floor has no navigable grid yet.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/floors/${config.id}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: originPoint(), end: dest.point }),
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
  }

  const directionSteps = route ? buildDirections(route.points, config.pixelToMm) : [];

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-white px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-ink/50 hover:text-ink">
            ← Floors
          </Link>
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
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Directory</h2>
          <div className="mt-2">
            <DirectorySearch destinations={destinations} onSelect={navigateTo} />
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
                  .filter((z) => !z.hidden)
                  .map((zone) => (
                    <polygon
                      key={zone.id}
                      points={zone.points.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="transparent"
                      stroke="#D8DBDF"
                      strokeWidth={1}
                      className="cursor-pointer hover:fill-accent/5"
                      onClick={() =>
                        navigateTo({
                          id: `zone:${zone.id}`,
                          name: zone.name,
                          subtitle: zone.category,
                          point: zone.points.reduce(
                            (acc, p) => ({ x: acc.x + p.x / zone.points.length, y: acc.y + p.y / zone.points.length }),
                            { x: 0, y: 0 },
                          ),
                        })
                      }
                    />
                  ))}

                {config.pois.map((poi) => (
                  <circle
                    key={poi.id}
                    cx={poi.x}
                    cy={poi.y}
                    r={natural ? Math.max(4, natural.width * 0.004) : 5}
                    fill={destination?.id === `poi:${poi.id}` ? '#2954D9' : '#1E2328'}
                    className="cursor-pointer"
                    onClick={() =>
                      navigateTo({ id: `poi:${poi.id}`, name: poi.name, subtitle: poi.type || 'POI', point: { x: poi.x, y: poi.y } })
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
                  />
                )}
                {route && (
                  <circle
                    cx={route.points[route.points.length - 1].x}
                    cy={route.points[route.points.length - 1].y}
                    r={natural ? Math.max(5, natural.width * 0.005) : 6}
                    fill="#2954D9"
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
