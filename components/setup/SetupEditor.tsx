'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import FloorImageStage, { type NaturalSize, type Point } from '../FloorImageStage';
import GridOverlay from './GridOverlay';
import ZoneForm from './ZoneForm';
import POIForm from './POIForm';
import LogoutButton from '../admin/LogoutButton';
import type { FloorConfig, POI, Zone, ZoneCategory } from '@/lib/types';

type Mode = 'select' | 'zone' | 'poi' | 'origin';

interface DetectedZoneItem {
  tempId: string;
  points: Point[];
  name: string;
  category: ZoneCategory;
  regionId: number;
}

interface DetectedPoiItem {
  tempId: string;
  label: string;
  type: string;
  prefix: string;
  x: number;
  y: number;
  zoneName: string | null;
}

interface RegionLabelConflict {
  regionId: number;
  labels: string[];
}

interface OrphanedLabel {
  text: string;
  x: number;
  y: number;
}

interface DetectReport {
  totalLabelsExtracted: number;
  duplicatePois: Record<string, number>;
  regionLabelConflicts: RegionLabelConflict[];
  orphanedLabels: OrphanedLabel[];
}

type ReshapeTarget =
  | { kind: 'zone'; id: string }
  | { kind: 'poi'; id: string }
  | { kind: 'detectedZone'; tempId: string }
  | { kind: 'detectedPoi'; tempId: string }
  | null;

export default function SetupEditor({ initialConfig }: { initialConfig: FloorConfig }) {
  const floorId = initialConfig.id;
  const [config, setConfig] = useState(initialConfig);
  const [mode, setMode] = useState<Mode>('select');
  const [draftZonePoints, setDraftZonePoints] = useState<Point[]>([]);
  const [pendingZonePoints, setPendingZonePoints] = useState<Point[] | null>(null);
  const [pendingPoiPoint, setPendingPoiPoint] = useState<Point | null>(null);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingPoiId, setEditingPoiId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [detectedZones, setDetectedZones] = useState<DetectedZoneItem[]>([]);
  const [detectedPois, setDetectedPois] = useState<DetectedPoiItem[]>([]);
  const [editingDetectedZoneId, setEditingDetectedZoneId] = useState<string | null>(null);
  const [textLayerAvailable, setTextLayerAvailable] = useState<boolean | null>(null);
  const [detectReport, setDetectReport] = useState<DetectReport | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [reshapeTarget, setReshapeTarget] = useState<ReshapeTarget>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialConfig.name);

  const hasImage = !!config.sourceImagePath;
  const closeThreshold = 16;
  const zoneIdByName = Object.fromEntries(config.zones.map((z) => [z.name, z.id]));

  async function refreshConfig() {
    const res = await fetch(`/api/floors/${floorId}/config`);
    if (res.ok) setConfig(await res.json());
  }

  async function runDetection() {
    setDetecting(true);
    setStatus('Extracting labels from PDF text layer…');
    const res = await fetch(`/api/floors/${floorId}/detect`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setTextLayerAvailable(data.textLayerAvailable);
      const zones: DetectedZoneItem[] = data.zones.map((z: any) => ({
        tempId: crypto.randomUUID(),
        points: z.points,
        name: z.name,
        category: z.category as ZoneCategory,
        regionId: z.regionId,
      }));
      const pois: DetectedPoiItem[] = data.pois.map((p: any) => ({
        tempId: crypto.randomUUID(),
        label: p.label,
        type: p.type,
        prefix: p.prefix,
        x: p.x,
        y: p.y,
        zoneName: p.zoneName,
      }));
      setDetectedZones(zones);
      setDetectedPois(pois);
      setDetectReport({
        totalLabelsExtracted: data.totalLabelsExtracted,
        duplicatePois: data.duplicatePois,
        regionLabelConflicts: data.regionLabelConflicts,
        orphanedLabels: data.orphanedLabels,
      });
      setStatus(
        data.textLayerAvailable
          ? `Extracted ${data.totalLabelsExtracted} labels — ${zones.length} candidate zone${zones.length === 1 ? '' : 's'}, ${pois.length} candidate POI${pois.length === 1 ? '' : 's'}.`
          : 'No PDF text layer for this floor plan (image-only upload) — nothing to auto-detect.',
      );
    } else {
      setStatus('Label extraction failed.');
    }
    setDetecting(false);
  }

  function confirmDetectedZone(tempId: string) {
    const dz = detectedZones.find((z) => z.tempId === tempId);
    if (!dz) return;
    const zone: Zone = { id: crypto.randomUUID(), name: dz.name, category: dz.category, points: dz.points, hidden: false };
    setConfig((c) => ({ ...c, zones: [...c.zones, zone] }));
    setDetectedZones((prev) => prev.filter((z) => z.tempId !== tempId));
    if (reshapeTarget?.kind === 'detectedZone' && reshapeTarget.tempId === tempId) setReshapeTarget(null);
  }

  function discardDetectedZone(tempId: string) {
    setDetectedZones((prev) => prev.filter((z) => z.tempId !== tempId));
    if (reshapeTarget?.kind === 'detectedZone' && reshapeTarget.tempId === tempId) setReshapeTarget(null);
  }

  function updateDetectedZone(tempId: string, values: { name: string; category: ZoneCategory }) {
    setDetectedZones((prev) => prev.map((z) => (z.tempId === tempId ? { ...z, ...values } : z)));
    setEditingDetectedZoneId(null);
  }

  function confirmDetectedPoi(tempId: string) {
    const dp = detectedPois.find((p) => p.tempId === tempId);
    if (!dp) return;
    const zoneId = dp.zoneName ? zoneIdByName[dp.zoneName] ?? null : null;
    const poi: POI = { id: crypto.randomUUID(), name: dp.label, type: dp.type, x: dp.x, y: dp.y, zoneId };
    setConfig((c) => ({ ...c, pois: [...c.pois, poi] }));
    setDetectedPois((prev) => prev.filter((p) => p.tempId !== tempId));
    if (reshapeTarget?.kind === 'detectedPoi' && reshapeTarget.tempId === tempId) setReshapeTarget(null);
  }

  function discardDetectedPoi(tempId: string) {
    setDetectedPois((prev) => prev.filter((p) => p.tempId !== tempId));
    if (reshapeTarget?.kind === 'detectedPoi' && reshapeTarget.tempId === tempId) setReshapeTarget(null);
  }

  function confirmAllDetectedZones() {
    detectedZones.forEach((z) => confirmDetectedZone(z.tempId));
  }

  function confirmAllDetectedPois() {
    detectedPois.forEach((p) => confirmDetectedPoi(p.tempId));
  }

  async function handleFileChosen(file: File) {
    setStatus('Uploading…');
    const form = new FormData();
    form.append('file', file);
    const uploadRes = await fetch(`/api/floors/${floorId}/upload`, { method: 'POST', body: form });
    if (!uploadRes.ok) {
      setStatus('Upload failed.');
      return;
    }
    setImageVersion((v) => v + 1);
    setStatus('Generating grid…');
    const gridRes = await fetch(`/api/floors/${floorId}/grid`, { method: 'POST' });
    if (!gridRes.ok) {
      const body = await gridRes.json().catch(() => ({}));
      setStatus(`Grid generation failed: ${body.error ?? gridRes.statusText}`);
      await refreshConfig();
      return;
    }
    await refreshConfig();
    await runDetection();
  }

  function handleCanvasClick(point: Point) {
    if (mode === 'zone') {
      if (draftZonePoints.length >= 3) {
        const first = draftZonePoints[0];
        if (Math.hypot(point.x - first.x, point.y - first.y) <= closeThreshold) {
          setPendingZonePoints(draftZonePoints);
          setDraftZonePoints([]);
          return;
        }
      }
      setDraftZonePoints((pts) => [...pts, point]);
    } else if (mode === 'poi') {
      setPendingPoiPoint(point);
    } else if (mode === 'origin') {
      setConfig((c) => ({ ...c, origin: { x: point.x, y: point.y } }));
    }
  }

  function addZone(values: { name: string; category: ZoneCategory }) {
    if (!pendingZonePoints) return;
    const zone: Zone = {
      id: crypto.randomUUID(),
      name: values.name,
      category: values.category,
      points: pendingZonePoints,
      hidden: false,
    };
    setConfig((c) => ({ ...c, zones: [...c.zones, zone] }));
    setPendingZonePoints(null);
  }

  function updateZone(id: string, values: { name: string; category: ZoneCategory }) {
    setConfig((c) => ({
      ...c,
      zones: c.zones.map((z) => (z.id === id ? { ...z, ...values } : z)),
    }));
    setEditingZoneId(null);
  }

  function toggleZoneHidden(id: string) {
    setConfig((c) => ({
      ...c,
      zones: c.zones.map((z) => (z.id === id ? { ...z, hidden: !z.hidden } : z)),
    }));
  }

  function deleteZone(id: string) {
    setConfig((c) => ({
      ...c,
      zones: c.zones.filter((z) => z.id !== id),
      pois: c.pois.map((p) => (p.zoneId === id ? { ...p, zoneId: null } : p)),
    }));
    if (reshapeTarget?.kind === 'zone' && reshapeTarget.id === id) setReshapeTarget(null);
  }

  function addPoi(values: { name: string; type: string; zoneId: string | null }) {
    if (!pendingPoiPoint) return;
    const poi: POI = { id: crypto.randomUUID(), ...values, x: pendingPoiPoint.x, y: pendingPoiPoint.y };
    setConfig((c) => ({ ...c, pois: [...c.pois, poi] }));
    setPendingPoiPoint(null);
  }

  function updatePoi(id: string, values: { name: string; type: string; zoneId: string | null }) {
    setConfig((c) => ({ ...c, pois: c.pois.map((p) => (p.id === id ? { ...p, ...values } : p)) }));
    setEditingPoiId(null);
  }

  function deletePoi(id: string) {
    setConfig((c) => ({ ...c, pois: c.pois.filter((p) => p.id !== id) }));
    if (reshapeTarget?.kind === 'poi' && reshapeTarget.id === id) setReshapeTarget(null);
  }

  async function renameFloor() {
    const name = nameDraft.trim();
    if (!name || name === config.name) {
      setEditingName(false);
      setNameDraft(config.name);
      return;
    }
    const res = await fetch(`/api/floors/${floorId}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      setConfig((c) => ({ ...c, name }));
      setStatus('Renamed.');
    } else {
      setNameDraft(config.name);
      setStatus('Rename failed.');
    }
    setEditingName(false);
  }

  async function handleSave() {
    setStatus('Saving…');
    const res = await fetch(`/api/floors/${floorId}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zones: config.zones, pois: config.pois, origin: config.origin }),
    });
    setStatus(res.ok ? 'Saved.' : 'Save failed.');
  }

  function startReshape(target: NonNullable<ReshapeTarget>) {
    setMode('select');
    setDraftZonePoints([]);
    setReshapeTarget(target);
  }

  function isReshaping(target: NonNullable<ReshapeTarget>): boolean {
    if (!reshapeTarget || reshapeTarget.kind !== target.kind) return false;
    if ('id' in reshapeTarget && 'id' in target) return reshapeTarget.id === target.id;
    if ('tempId' in reshapeTarget && 'tempId' in target) return reshapeTarget.tempId === target.tempId;
    return false;
  }

  function editablePointsFor(): Point[] | undefined {
    if (!reshapeTarget) return undefined;
    switch (reshapeTarget.kind) {
      case 'zone':
        return config.zones.find((z) => z.id === reshapeTarget.id)?.points;
      case 'poi': {
        const poi = config.pois.find((p) => p.id === reshapeTarget.id);
        return poi ? [{ x: poi.x, y: poi.y }] : undefined;
      }
      case 'detectedZone':
        return detectedZones.find((z) => z.tempId === reshapeTarget.tempId)?.points;
      case 'detectedPoi': {
        const poi = detectedPois.find((p) => p.tempId === reshapeTarget.tempId);
        return poi ? [{ x: poi.x, y: poi.y }] : undefined;
      }
      default:
        return undefined;
    }
  }

  function handleEditablePointsChange(points: Point[]) {
    if (!reshapeTarget) return;
    switch (reshapeTarget.kind) {
      case 'zone':
        setConfig((c) => ({ ...c, zones: c.zones.map((z) => (z.id === reshapeTarget.id ? { ...z, points } : z)) }));
        break;
      case 'poi':
        setConfig((c) => ({
          ...c,
          pois: c.pois.map((p) => (p.id === reshapeTarget.id ? { ...p, x: points[0].x, y: points[0].y } : p)),
        }));
        break;
      case 'detectedZone':
        setDetectedZones((prev) => prev.map((z) => (z.tempId === reshapeTarget.tempId ? { ...z, points } : z)));
        break;
      case 'detectedPoi':
        setDetectedPois((prev) =>
          prev.map((p) => (p.tempId === reshapeTarget.tempId ? { ...p, x: points[0].x, y: points[0].y } : p)),
        );
        break;
    }
  }

  const editingZone = editingZoneId ? config.zones.find((z) => z.id === editingZoneId) ?? null : null;
  const editingPoi = editingPoiId ? config.pois.find((p) => p.id === editingPoiId) ?? null : null;
  const editingDetectedZone = editingDetectedZoneId
    ? detectedZones.find((z) => z.tempId === editingDetectedZoneId) ?? null
    : null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-white px-4 py-2.5">
        <div className="flex items-center gap-3">
          {editingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                renameFloor();
              }}
              className="flex items-center gap-1.5"
            >
              <span className="text-sm font-semibold">Setup —</span>
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={renameFloor}
                className="border border-border px-1.5 py-0.5 text-sm font-semibold"
              />
            </form>
          ) : (
            <h1 className="text-sm font-semibold">
              Setup — {config.name}{' '}
              <button
                onClick={() => {
                  setNameDraft(config.name);
                  setEditingName(true);
                }}
                className="ml-1 text-xs font-normal text-ink/50 hover:text-ink hover:underline"
              >
                Rename
              </button>
            </h1>
          )}
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={`/wayfinder/${floorId}`}
            className="border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface"
          >
            Preview Wayfinder →
          </Link>
          <LogoutButton />
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileChosen(file);
          e.target.value = '';
        }}
      />

      {!hasImage ? (
        <div className="flex flex-1 items-center justify-center bg-surface p-6">
          <div className="w-full max-w-sm border border-border bg-white p-8 text-center">
            <h2 className="text-lg font-semibold">Upload a floor plan to begin</h2>
            <p className="mt-2 text-sm text-ink/60">
              Zones, POIs, and routing can&apos;t be set up until a floor plan image or PDF is uploaded.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 w-full bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Upload floor plan…
            </button>
            {status && <p className="mt-3 text-xs text-ink/60">{status}</p>}
          </div>
        </div>
      ) : (
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-border bg-white p-4">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Floor plan</h2>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 w-full border border-border px-3 py-1.5 text-sm hover:bg-surface"
            >
              Replace floor plan…
            </button>
            {config.grid && (
              <button
                onClick={runDetection}
                disabled={detecting}
                className="mt-2 w-full border border-border px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-50"
              >
                {detecting ? 'Extracting…' : 'Extract labels from PDF'}
              </button>
            )}
            {status && <p className="mt-1.5 text-xs text-ink/60">{status}</p>}
            {textLayerAvailable === false && (
              <p className="mt-1.5 text-xs text-ink/50">
                This floor plan has no PDF text layer (uploaded as an image, not a PDF) — nothing to extract.
              </p>
            )}
            {config.grid && (
              <label className="mt-2 flex items-center gap-2 text-xs text-ink/70">
                <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                Show occupancy grid (debug)
              </label>
            )}
          </section>

          <section className="mt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Tools</h2>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {(['select', 'zone', 'poi', 'origin'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setDraftZonePoints([]);
                    setReshapeTarget(null);
                  }}
                  className={`border px-2 py-1.5 text-xs font-medium capitalize ${
                    mode === m ? 'border-accent bg-accent text-white' : 'border-border hover:bg-surface'
                  }`}
                >
                  {m === 'poi' ? 'Place POI' : m === 'origin' ? 'You are here' : m}
                </button>
              ))}
            </div>
            {mode === 'zone' && (
              <p className="mt-2 text-xs text-ink/60">
                Click to place vertices. Click the first vertex again to close the zone.
                {draftZonePoints.length > 0 && (
                  <button className="ml-1 text-accent underline" onClick={() => setDraftZonePoints([])}>
                    Cancel
                  </button>
                )}
              </p>
            )}
            {mode === 'poi' && <p className="mt-2 text-xs text-ink/60">Click the canvas to drop a marker.</p>}
            {mode === 'origin' && (
              <p className="mt-2 text-xs text-ink/60">
                Click the map to set the kiosk&apos;s “You are here” point — every Wayfinder route starts here.
                {config.origin && (
                  <button className="ml-1 text-accent underline" onClick={() => setConfig((c) => ({ ...c, origin: null }))}>
                    Clear
                  </button>
                )}
              </p>
            )}
            {reshapeTarget && (
              <p className="mt-2 text-xs text-ink/60">
                Drag the handle on the canvas to reshape.
                <button className="ml-1 text-accent underline" onClick={() => setReshapeTarget(null)}>
                  Done
                </button>
              </p>
            )}
          </section>

          {pendingZonePoints && (
            <section className="mt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">New zone</h2>
              <div className="mt-2">
                <ZoneForm onSubmit={addZone} onCancel={() => setPendingZonePoints(null)} />
              </div>
            </section>
          )}

          {editingZone && (
            <section className="mt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Edit zone</h2>
              <div className="mt-2">
                <ZoneForm
                  initial={editingZone}
                  onSubmit={(values) => updateZone(editingZone.id, values)}
                  onCancel={() => setEditingZoneId(null)}
                />
              </div>
            </section>
          )}

          {pendingPoiPoint && (
            <section className="mt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">New POI</h2>
              <div className="mt-2">
                <POIForm zones={config.zones} onSubmit={addPoi} onCancel={() => setPendingPoiPoint(null)} />
              </div>
            </section>
          )}

          {editingPoi && (
            <section className="mt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Edit POI</h2>
              <div className="mt-2">
                <POIForm
                  zones={config.zones}
                  initial={editingPoi}
                  onSubmit={(values) => updatePoi(editingPoi.id, values)}
                  onCancel={() => setEditingPoiId(null)}
                />
              </div>
            </section>
          )}

          {editingDetectedZone && (
            <section className="mt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Edit detected zone</h2>
              <div className="mt-2">
                <ZoneForm
                  initial={editingDetectedZone}
                  onSubmit={(values) => updateDetectedZone(editingDetectedZone.tempId, values)}
                  onCancel={() => setEditingDetectedZoneId(null)}
                />
              </div>
            </section>
          )}

          {detectReport &&
            (Object.keys(detectReport.duplicatePois).length > 0 ||
              detectReport.regionLabelConflicts.length > 0 ||
              detectReport.orphanedLabels.length > 0) && (
              <section className="mt-5 border border-dashed border-border p-2.5 text-xs">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Review flags</h2>
                {Object.keys(detectReport.duplicatePois).length > 0 && (
                  <div className="mt-2">
                    <div className="font-medium">Duplicate POI IDs ({Object.keys(detectReport.duplicatePois).length})</div>
                    <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-ink/60">
                      {Object.entries(detectReport.duplicatePois).map(([label, count]) => (
                        <li key={label}>
                          {label} — appears {count}×
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {detectReport.regionLabelConflicts.length > 0 && (
                  <div className="mt-2">
                    <div className="font-medium">
                      Multiple labels sharing one region ({detectReport.regionLabelConflicts.length})
                    </div>
                    <p className="mt-0.5 text-ink/50">
                      These room labels landed in the same connected walkable area, so they were assigned the same
                      polygon — likely a compound/open-plan space, or the occupancy grid didn&apos;t detect a wall
                      between them. Review the zones below before confirming.
                    </p>
                    <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-ink/60">
                      {detectReport.regionLabelConflicts.map((c) => (
                        <li key={c.regionId}>
                          Region {c.regionId}: {c.labels.join(', ')}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {detectReport.orphanedLabels.length > 0 && (
                  <div className="mt-2">
                    <div className="font-medium">Orphaned labels ({detectReport.orphanedLabels.length})</div>
                    <p className="mt-0.5 text-ink/50">Didn&apos;t land in any connected walkable region.</p>
                    <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-ink/60">
                      {detectReport.orphanedLabels.map((l, i) => (
                        <li key={i}>{l.text}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

          {detectedZones.length > 0 && (
            <section className="mt-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                  Detected zones ({detectedZones.length})
                </h2>
                <div className="flex gap-2 text-xs">
                  <button className="text-accent hover:underline" onClick={confirmAllDetectedZones}>
                    Confirm all
                  </button>
                  <button
                    className="text-ink/50 hover:text-ink"
                    onClick={() => setDetectedZones([])}
                  >
                    Discard all
                  </button>
                </div>
              </div>
              <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
                {detectedZones.map((zone) => (
                  <li key={zone.tempId} className="border border-dashed border-border px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{zone.name}</div>
                        <div className="text-ink/50">{zone.category} · auto-detected</div>
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <button className="text-accent hover:underline" onClick={() => confirmDetectedZone(zone.tempId)}>
                        Confirm
                      </button>
                      <button className="text-accent hover:underline" onClick={() => setEditingDetectedZoneId(zone.tempId)}>
                        Edit
                      </button>
                      <button
                        className="text-accent hover:underline"
                        onClick={() => startReshape({ kind: 'detectedZone', tempId: zone.tempId })}
                      >
                        {isReshaping({ kind: 'detectedZone', tempId: zone.tempId }) ? 'Reshaping…' : 'Reshape'}
                      </button>
                      <button className="text-ink/50 hover:text-ink" onClick={() => discardDetectedZone(zone.tempId)}>
                        Discard
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detectedPois.length > 0 && (
            <section className="mt-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                  Detected POIs ({detectedPois.length})
                </h2>
                <div className="flex gap-2 text-xs">
                  <button className="text-accent hover:underline" onClick={confirmAllDetectedPois}>
                    Confirm all
                  </button>
                  <button className="text-ink/50 hover:text-ink" onClick={() => setDetectedPois([])}>
                    Discard all
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-ink/50">Confirm zones first so POIs can link to them by name.</p>
              <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
                {detectedPois.map((poi) => (
                  <li key={poi.tempId} className="border border-dashed border-border px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{poi.label}</div>
                        <div className="text-ink/50">
                          {poi.type} · {poi.zoneName ?? 'no zone match'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <button className="text-accent hover:underline" onClick={() => confirmDetectedPoi(poi.tempId)}>
                        Confirm
                      </button>
                      <button
                        className="text-accent hover:underline"
                        onClick={() => startReshape({ kind: 'detectedPoi', tempId: poi.tempId })}
                      >
                        {isReshaping({ kind: 'detectedPoi', tempId: poi.tempId }) ? 'Moving…' : 'Move'}
                      </button>
                      <button className="text-ink/50 hover:text-ink" onClick={() => discardDetectedPoi(poi.tempId)}>
                        Discard
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">
              Zones ({config.zones.length})
            </h2>
            <ul className="mt-2 space-y-1.5">
              {config.zones.map((zone) => (
                <li key={zone.id} className={`border border-border px-2 py-1.5 text-xs ${zone.hidden ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">
                        {zone.name}
                        {zone.hidden && <span className="ml-1.5 text-ink/40">(hidden)</span>}
                      </div>
                      <div className="text-ink/50">{zone.category}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 flex gap-2">
                    <button className="text-accent hover:underline" onClick={() => setEditingZoneId(zone.id)}>
                      Edit
                    </button>
                    <button
                      className="text-accent hover:underline"
                      onClick={() => startReshape({ kind: 'zone', id: zone.id })}
                    >
                      {isReshaping({ kind: 'zone', id: zone.id }) ? 'Reshaping…' : 'Reshape'}
                    </button>
                    <button className="text-accent hover:underline" onClick={() => toggleZoneHidden(zone.id)}>
                      {zone.hidden ? 'Show' : 'Hide'}
                    </button>
                    <button className="text-ink/50 hover:text-ink" onClick={() => deleteZone(zone.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/50">POIs ({config.pois.length})</h2>
            <ul className="mt-2 space-y-1.5">
              {config.pois.map((poi) => (
                <li key={poi.id} className="border border-border px-2 py-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{poi.name}</div>
                      <div className="text-ink/50">{poi.type || 'POI'}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 flex gap-2">
                    <button className="text-accent hover:underline" onClick={() => setEditingPoiId(poi.id)}>
                      Edit
                    </button>
                    <button
                      className="text-accent hover:underline"
                      onClick={() => startReshape({ kind: 'poi', id: poi.id })}
                    >
                      {isReshaping({ kind: 'poi', id: poi.id }) ? 'Moving…' : 'Move'}
                    </button>
                    <button className="text-ink/50 hover:text-ink" onClick={() => deletePoi(poi.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <button
            onClick={handleSave}
            className="mt-6 w-full bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Save changes
          </button>
        </aside>

        <main className="flex-1 overflow-auto bg-surface p-4">
          <FloorImageStage
            floorId={floorId}
            hasImage={hasImage}
            version={imageVersion}
            cursor={mode === 'select' ? 'default' : 'crosshair'}
            onClickImage={handleCanvasClick}
            editablePoints={editablePointsFor()}
            onEditablePointsChange={handleEditablePointsChange}
            overlay={(natural: NaturalSize) => (
              <>
                {showGrid && config.grid && <GridOverlay grid={config.grid} natural={natural} />}

                {detectedZones.map((zone) => (
                  <g key={zone.tempId}>
                    <polygon
                      points={zone.points.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="rgba(30,35,40,0.04)"
                      stroke="#1E2328"
                      strokeDasharray="8 5"
                      strokeWidth={Math.max(1, natural.width * 0.0015)}
                    />
                  </g>
                ))}
                {detectedPois.map((poi) => (
                  <circle
                    key={poi.tempId}
                    cx={poi.x}
                    cy={poi.y}
                    r={Math.max(4, natural.width * 0.004)}
                    fill="none"
                    stroke="#1E2328"
                    strokeDasharray="3 2"
                    strokeWidth={1.5}
                  />
                ))}

                {config.zones.map((zone) => (
                  <polygon
                    key={zone.id}
                    points={zone.points.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={zone.hidden ? 'rgba(120,120,120,0.06)' : 'rgba(41,84,217,0.10)'}
                    stroke={zone.hidden ? '#9CA3AF' : '#2954D9'}
                    strokeDasharray={zone.hidden ? '4 4' : undefined}
                    strokeWidth={Math.max(1, natural.width * 0.0015)}
                  />
                ))}
                {draftZonePoints.length > 0 && (
                  <polyline
                    points={draftZonePoints.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="#2954D9"
                    strokeDasharray="6 4"
                    strokeWidth={Math.max(1, natural.width * 0.0015)}
                  />
                )}
                {draftZonePoints.map((p, i) => (
                  <circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={Math.max(3, natural.width * 0.003)}
                    fill={i === 0 ? '#2954D9' : '#ffffff'}
                    stroke="#2954D9"
                    strokeWidth={1.5}
                  />
                ))}
                {config.pois.map((poi) => (
                  <g key={poi.id}>
                    <circle cx={poi.x} cy={poi.y} r={Math.max(4, natural.width * 0.004)} fill="#1E2328" />
                    <text x={poi.x + 8} y={poi.y + 4} fontSize={natural.width * 0.012} fill="#1E2328">
                      {poi.name}
                    </text>
                  </g>
                ))}
                {pendingPoiPoint && (
                  <circle
                    cx={pendingPoiPoint.x}
                    cy={pendingPoiPoint.y}
                    r={Math.max(4, natural.width * 0.004)}
                    fill="#2954D9"
                  />
                )}
                {config.origin && (
                  <g>
                    <circle
                      cx={config.origin.x}
                      cy={config.origin.y}
                      r={Math.max(5, natural.width * 0.006)}
                      fill="#16A34A"
                      stroke="#ffffff"
                      strokeWidth={Math.max(1, natural.width * 0.0015)}
                    />
                    <text
                      x={config.origin.x + Math.max(8, natural.width * 0.01)}
                      y={config.origin.y + 4}
                      fontSize={natural.width * 0.012}
                      fill="#16A34A"
                    >
                      You are here
                    </text>
                  </g>
                )}
              </>
            )}
          />
        </main>
      </div>
      )}
    </div>
  );
}
