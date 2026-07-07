'use client';

import { useRef, useState } from 'react';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { filterVisible, pointInPolygon } from '@/lib/graph';
import { newId } from '@/lib/id';
import type { Graph, Zone } from '@/lib/types';
import WayfinderView from '@/components/wayfinder/WayfinderView';
import EntityPanel from './EntityPanel';
import Toolbar from './Toolbar';
import ZoneForm from './ZoneForm';

export type Tool = 'select' | 'zone' | 'here';

const HISTORY_LIMIT = 20;
const MIN_ZONE_DRAG_PX = 12;

type Point = { x: number; y: number };
type ZoneDrag =
  | { mode: 'draw'; start: Point; current: Point }
  | { mode: 'vertex'; zoneId: string; vertexIndex: number }
  | { mode: 'body'; zoneId: string; start: Point; originalPoints: [number, number][] };

export default function SetupEditor({
  planId,
  initialGraph,
  initialZones,
  imageUrl,
}: {
  planId: string;
  initialGraph: Graph;
  initialZones: Zone[];
  imageUrl: string;
}) {
  const [graph, setGraph] = useState<Graph>(initialGraph);
  const [past, setPast] = useState<Graph[]>([]);
  const [future, setFuture] = useState<Graph[]>([]);
  const [zones, setZones] = useState<Zone[]>(initialZones);
  const [tool, setTool] = useState<Tool>('zone');
  const [previewMode, setPreviewMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [zoneDrag, setZoneDrag] = useState<ZoneDrag | null>(null);
  const [pendingZonePoints, setPendingZonePoints] = useState<[number, number][] | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);

  const { imageWidth, imageHeight } = graph.floorPlan;
  const zoneVertexRadius = Math.max(7, imageWidth / 160);
  const hereRadius = Math.max(8, imageWidth / 120);

  function commit(next: Graph) {
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), graph]);
    setFuture([]);
    setGraph(next);
    setSaveStatus('idle');
  }

  function undo() {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setFuture((f) => [graph, ...f.slice(0, HISTORY_LIMIT - 1)]);
    setPast((p) => p.slice(0, -1));
    setGraph(prev);
  }

  function redo() {
    if (future.length === 0) return;
    const next = future[0];
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), graph]);
    setFuture((f) => f.slice(1));
    setGraph(next);
  }

  function hitTestZoneVertex(x: number, y: number, zone: Zone): number | null {
    for (let i = 0; i < zone.points.length; i += 1) {
      const [px, py] = zone.points[i];
      if (Math.hypot(x - px, y - py) <= zoneVertexRadius + 4) return i;
    }
    return null;
  }

  function toImageCoords(e: { clientX: number; clientY: number }): Point {
    const rect = wrapperRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * imageWidth,
      y: ((e.clientY - rect.top) / rect.height) * imageHeight,
    };
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!wrapperRef.current || tool === 'zone') return;
    if (tool === 'here') {
      const { x, y } = toImageCoords(e);
      commit({ ...graph, youAreHere: { x, y } });
    }
  }

  function handleZoneMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (tool !== 'zone' || !wrapperRef.current) return;
    const point = toImageCoords(e);

    if (selectedZoneId) {
      const selected = zones.find((z) => z.id === selectedZoneId);
      if (selected) {
        const vertexIndex = hitTestZoneVertex(point.x, point.y, selected);
        if (vertexIndex !== null) {
          setZoneDrag({ mode: 'vertex', zoneId: selected.id, vertexIndex });
          return;
        }
      }
    }

    const hitZone = [...zones].reverse().find((z) => pointInPolygon(point, z.points));
    if (hitZone) {
      setSelectedZoneId(hitZone.id);
      setZoneDrag({ mode: 'body', zoneId: hitZone.id, start: point, originalPoints: hitZone.points });
      return;
    }

    setSelectedZoneId(null);
    setZoneDrag({ mode: 'draw', start: point, current: point });
  }

  function handleZoneMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!zoneDrag || !wrapperRef.current) return;
    const point = toImageCoords(e);

    if (zoneDrag.mode === 'draw') {
      setZoneDrag({ ...zoneDrag, current: point });
    } else if (zoneDrag.mode === 'vertex') {
      setZones((zs) =>
        zs.map((z) =>
          z.id === zoneDrag.zoneId
            ? { ...z, points: z.points.map((p, i) => (i === zoneDrag.vertexIndex ? [point.x, point.y] : p)) }
            : z,
        ),
      );
    } else if (zoneDrag.mode === 'body') {
      const dx = point.x - zoneDrag.start.x;
      const dy = point.y - zoneDrag.start.y;
      setZones((zs) =>
        zs.map((z) =>
          z.id === zoneDrag.zoneId
            ? { ...z, points: zoneDrag.originalPoints.map(([px, py]) => [px + dx, py + dy]) }
            : z,
        ),
      );
    }
  }

  function handleZoneMouseUp() {
    if (!zoneDrag) return;
    if (zoneDrag.mode === 'draw') {
      const { start, current } = zoneDrag;
      const w = Math.abs(current.x - start.x);
      const h = Math.abs(current.y - start.y);
      if (w >= MIN_ZONE_DRAG_PX && h >= MIN_ZONE_DRAG_PX) {
        const x1 = Math.min(start.x, current.x);
        const x2 = Math.max(start.x, current.x);
        const y1 = Math.min(start.y, current.y);
        const y2 = Math.max(start.y, current.y);
        setPendingZonePoints([
          [x1, y1],
          [x2, y1],
          [x2, y2],
          [x1, y2],
        ]);
      }
    }
    setZoneDrag(null);
  }

  function saveNewZone(name: string) {
    if (!pendingZonePoints) return;
    const zone: Zone = { id: newId('zone'), name, points: pendingZonePoints, hidden: false };
    setZones((zs) => [...zs, zone]);
    setSelectedZoneId(zone.id);
    setPendingZonePoints(null);
  }

  function cancelNewZone() {
    setPendingZonePoints(null);
  }

  function renameZone(zoneId: string, name: string) {
    setZones((zs) => zs.map((z) => (z.id === zoneId ? { ...z, name } : z)));
  }

  function toggleZoneHidden(zoneId: string) {
    setZones((zs) => zs.map((z) => (z.id === zoneId ? { ...z, hidden: !z.hidden } : z)));
  }

  function deleteZone(zoneId: string) {
    setZones((zs) => zs.filter((z) => z.id !== zoneId));
    if (selectedZoneId === zoneId) setSelectedZoneId(null);
  }

  function clearYouAreHere() {
    commit({ ...graph, youAreHere: null });
  }

  function focusOn(x: number, y: number) {
    const el = transformRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const rect = container.getBoundingClientRect();
    const scale = el.state.scale;
    el.setTransform(rect.width / 2 - x * scale, rect.height / 2 - y * scale, scale, 300);
  }

  function fitToViewport(animationTime = 300) {
    const el = transformRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const rect = container.getBoundingClientRect();
    const fitScale = Math.min(rect.width / imageWidth, rect.height / imageHeight) * 0.95;
    el.setTransform(
      rect.width / 2 - (imageWidth / 2) * fitScale,
      rect.height / 2 - (imageHeight / 2) * fitScale,
      fitScale,
      animationTime,
    );
  }

  async function handleSave() {
    setSaveStatus('saving');
    try {
      const [graphRes, zonesRes] = await Promise.all([
        fetch(`/api/floorplans/${planId}/graph`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(graph),
        }),
        fetch(`/api/floorplans/${planId}/zones`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zones }),
        }),
      ]);
      if (!graphRes.ok || !zonesRes.ok) throw new Error('save failed');
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2000);
    } catch {
      setSaveStatus('error');
    }
  }

  if (previewMode) {
    // Preview should show exactly what the public view will -- same filterVisible() the
    // real public page uses, so the two can't quietly drift apart.
    return (
      <WayfinderView
        graph={graph}
        zones={filterVisible(zones)}
        imageUrl={imageUrl}
        gridUrl={`/api/floorplans/${planId}/grid`}
        onExitPreview={() => setPreviewMode(false)}
      />
    );
  }

  const drawRect =
    zoneDrag?.mode === 'draw'
      ? {
          x: Math.min(zoneDrag.start.x, zoneDrag.current.x),
          y: Math.min(zoneDrag.start.y, zoneDrag.current.y),
          w: Math.abs(zoneDrag.current.x - zoneDrag.start.x),
          h: Math.abs(zoneDrag.current.y - zoneDrag.start.y),
        }
      : null;

  return (
    <div className="flex h-screen flex-col">
      <Toolbar
        tool={tool}
        onToolChange={(t) => {
          setTool(t);
          setSelectedZoneId(null);
          setZoneDrag(null);
        }}
        onUndo={undo}
        onRedo={redo}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onSave={handleSave}
        saveStatus={saveStatus}
        previewMode={previewMode}
        onTogglePreview={() => setPreviewMode(true)}
        onResetZoom={() => fitToViewport()}
      />

      <div className="flex min-h-0 flex-1">
        <div ref={containerRef} className="relative flex-1 overflow-hidden bg-slate-200">
          <TransformWrapper
            ref={transformRef}
            minScale={0.05}
            maxScale={8}
            panning={{ disabled: true }}
            doubleClick={{ disabled: true }}
            onInit={() => {
              // The canvas is the image's native pixel size (often several thousand px) --
              // centerOnInit only centers, it doesn't fit, so without this it starts at
              // scale=1 showing a tiny corner of the floor plan at native resolution. Fit the
              // whole plan in the viewport on load instead, like the public view already does.
              fitToViewport(0);
            }}
          >
            <TransformComponent wrapperClass="!w-full !h-full">
              <div
                ref={wrapperRef}
                onClick={handleCanvasClick}
                onMouseDown={handleZoneMouseDown}
                onMouseMove={handleZoneMouseMove}
                onMouseUp={handleZoneMouseUp}
                onMouseLeave={handleZoneMouseUp}
                className="relative"
                style={{
                  width: imageWidth,
                  height: imageHeight,
                  // Promotes the whole transformed subtree to its own GPU layer ahead of
                  // time. Profiled: without this, zoom animation drops ~31% of frames once
                  // the canvas has hundreds of SVG child elements (each has to be repainted
                  // every frame otherwise); with it, drops to ~0% under the same load.
                  willChange: 'transform',
                  cursor: tool === 'select' ? 'default' : 'crosshair',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={graph.floorPlan.name} width={imageWidth} height={imageHeight} draggable={false} className="select-none" />
                <svg viewBox={`0 0 ${imageWidth} ${imageHeight}`} width={imageWidth} height={imageHeight} className="absolute inset-0">
                  {zones.map((zone) => {
                    const isSelected = zone.id === selectedZoneId;
                    return (
                      <g key={zone.id}>
                        <polygon
                          points={zone.points.map(([x, y]) => `${x},${y}`).join(' ')}
                          fill={zone.hidden ? 'rgba(148,163,184,0.15)' : isSelected ? 'rgba(67,56,202,0.3)' : 'rgba(99,102,241,0.12)'}
                          stroke={zone.hidden ? '#94a3b8' : isSelected ? '#4338ca' : '#6366f1'}
                          strokeWidth={isSelected ? 3 : 2}
                          strokeDasharray={zone.hidden ? '6 4' : undefined}
                          className={tool === 'zone' ? 'cursor-move' : ''}
                        />
                        <text
                          x={zone.points[0][0]}
                          y={zone.points[0][1] - 8}
                          fontSize={Math.max(12, imageWidth / 160)}
                          fill="#4338ca"
                          className="pointer-events-none select-none font-medium"
                        >
                          {zone.name}
                        </text>
                        {isSelected &&
                          tool === 'zone' &&
                          zone.points.map(([x, y], i) => (
                            <circle
                              key={i}
                              cx={x}
                              cy={y}
                              r={zoneVertexRadius}
                              fill="#f59e0b"
                              stroke="white"
                              strokeWidth={2}
                              className="cursor-grab"
                            />
                          ))}
                      </g>
                    );
                  })}

                  {drawRect && (
                    <rect
                      x={drawRect.x}
                      y={drawRect.y}
                      width={drawRect.w}
                      height={drawRect.h}
                      fill="rgba(67,56,202,0.15)"
                      stroke="#4338ca"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                    />
                  )}

                  {graph.youAreHere && (
                    <g transform={`translate(${graph.youAreHere.x} ${graph.youAreHere.y})`}>
                      <circle r={hereRadius} fill="#0ea5e9" stroke="white" strokeWidth={3} />
                      <text
                        y={-hereRadius - 6}
                        textAnchor="middle"
                        fontSize={Math.max(11, imageWidth / 130)}
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

        <EntityPanel
          zones={zones}
          selectedZoneId={selectedZoneId}
          youAreHere={graph.youAreHere}
          onFocus={focusOn}
          onFocusZone={(zone) => {
            setSelectedZoneId(zone.id);
            const [x, y] = zone.points[0];
            focusOn(x, y);
          }}
          onRenameZone={renameZone}
          onToggleZoneHidden={toggleZoneHidden}
          onDeleteZone={deleteZone}
          onClearYouAreHere={clearYouAreHere}
        />
      </div>

      {pendingZonePoints && <ZoneForm onSave={saveNewZone} onCancel={cancelNewZone} />}
    </div>
  );
}
