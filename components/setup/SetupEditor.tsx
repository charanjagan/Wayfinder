'use client';

import { useRef, useState } from 'react';
import { distance, nearestWaypointId } from '@/lib/graph';
import { newId } from '@/lib/id';
import type { Category, Edge, Graph, POI, Waypoint } from '@/lib/types';
import WayfinderView from '@/components/wayfinder/WayfinderView';
import EntityPanel from './EntityPanel';
import POIForm from './POIForm';
import Toolbar from './Toolbar';

export type Tool = 'select' | 'waypoint' | 'poi';

export interface DraftPoi {
  x: number;
  y: number;
  name: string;
  category: Category;
  aliases: string;
  nearestWaypoint: string;
  isEntrance: boolean;
}

const HISTORY_LIMIT = 20;
const CATEGORY_FILL: Record<Category, string> = {
  zone: '#6366f1',
  room: '#059669',
  facility: '#d97706',
};

export default function SetupEditor({
  planId,
  initialGraph,
  imageUrl,
}: {
  planId: string;
  initialGraph: Graph;
  imageUrl: string;
}) {
  const [graph, setGraph] = useState<Graph>(initialGraph);
  const [past, setPast] = useState<Graph[]>([]);
  const [future, setFuture] = useState<Graph[]>([]);
  const [tool, setTool] = useState<Tool>('waypoint');
  const [pendingEdgeFrom, setPendingEdgeFrom] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftPoi | null>(null);
  const [draftEditingId, setDraftEditingId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { imageWidth, imageHeight } = graph.floorPlan;
  const waypointHitRadius = Math.max(8, imageWidth / 150);
  const poiHitRadius = Math.max(10, imageWidth / 120);
  const waypointRadius = Math.max(5, imageWidth / 200);
  const poiRadius = Math.max(6, imageWidth / 140);

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

  function hitTestWaypoint(x: number, y: number): Waypoint | null {
    let best: Waypoint | null = null;
    let bestDist = waypointHitRadius;
    for (const wp of graph.waypoints) {
      const d = distance(wp, { x, y });
      if (d <= bestDist) {
        bestDist = d;
        best = wp;
      }
    }
    return best;
  }

  function hitTestPoi(x: number, y: number): POI | null {
    let best: POI | null = null;
    let bestDist = poiHitRadius;
    for (const poi of graph.pois) {
      const d = distance(poi, { x, y });
      if (d <= bestDist) {
        bestDist = d;
        best = poi;
      }
    }
    return best;
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * imageWidth;
    const y = ((e.clientY - rect.top) / rect.height) * imageHeight;

    if (tool === 'waypoint') {
      const hit = hitTestWaypoint(x, y);
      if (hit) {
        if (pendingEdgeFrom === hit.id) {
          setPendingEdgeFrom(null);
          return;
        }
        if (pendingEdgeFrom) {
          const exists = graph.edges.some(
            (edge) =>
              (edge.from === pendingEdgeFrom && edge.to === hit.id) || (edge.from === hit.id && edge.to === pendingEdgeFrom),
          );
          if (!exists) {
            const newEdge: Edge = { from: pendingEdgeFrom, to: hit.id };
            commit({ ...graph, edges: [...graph.edges, newEdge] });
          }
          setPendingEdgeFrom(null);
          return;
        }
        setPendingEdgeFrom(hit.id);
        return;
      }
      const wp: Waypoint = { id: newId('wp'), x, y };
      commit({ ...graph, waypoints: [...graph.waypoints, wp] });
    } else if (tool === 'poi') {
      const hitPoi = hitTestPoi(x, y);
      if (hitPoi) {
        openEditForm(hitPoi);
        return;
      }
      openNewForm(x, y);
    }
  }

  function openNewForm(x: number, y: number) {
    const nearest = nearestWaypointId(graph.waypoints, { x, y }) ?? '';
    setDraft({ x, y, name: '', category: 'room', aliases: '', nearestWaypoint: nearest, isEntrance: false });
    setDraftEditingId(null);
  }

  function openEditForm(poi: POI) {
    setDraft({
      x: poi.x,
      y: poi.y,
      name: poi.name,
      category: poi.category,
      aliases: (poi.aliases ?? []).join(', '),
      nearestWaypoint: poi.nearestWaypoint,
      isEntrance: !!poi.isEntrance,
    });
    setDraftEditingId(poi.id);
  }

  function saveDraft() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return;
    const aliases = draft.aliases
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (draftEditingId) {
      const pois = graph.pois.map((p) => {
        if (p.id === draftEditingId) {
          return {
            ...p,
            name,
            category: draft.category,
            aliases: aliases.length ? aliases : undefined,
            nearestWaypoint: draft.nearestWaypoint,
            isEntrance: draft.isEntrance || undefined,
          };
        }
        return draft.isEntrance ? { ...p, isEntrance: undefined } : p;
      });
      commit({ ...graph, pois });
    } else {
      const newPoi: POI = {
        id: newId('poi'),
        name,
        category: draft.category,
        x: draft.x,
        y: draft.y,
        nearestWaypoint: draft.nearestWaypoint,
        aliases: aliases.length ? aliases : undefined,
        isEntrance: draft.isEntrance || undefined,
      };
      const pois = draft.isEntrance
        ? [...graph.pois.map((p) => ({ ...p, isEntrance: undefined })), newPoi]
        : [...graph.pois, newPoi];
      commit({ ...graph, pois });
    }
    setDraft(null);
    setDraftEditingId(null);
  }

  function cancelDraft() {
    setDraft(null);
    setDraftEditingId(null);
  }

  function deleteDraft() {
    if (draftEditingId) {
      commit({ ...graph, pois: graph.pois.filter((p) => p.id !== draftEditingId) });
    }
    setDraft(null);
    setDraftEditingId(null);
  }

  function deleteWaypoint(wp: Waypoint) {
    const remainingWaypoints = graph.waypoints.filter((w) => w.id !== wp.id);
    const remainingEdges = graph.edges.filter((e) => e.from !== wp.id && e.to !== wp.id);
    const pois = graph.pois.map((p) => {
      if (p.nearestWaypoint !== wp.id) return p;
      const next = nearestWaypointId(remainingWaypoints, p);
      return { ...p, nearestWaypoint: next ?? '' };
    });
    commit({ ...graph, waypoints: remainingWaypoints, edges: remainingEdges, pois });
    if (pendingEdgeFrom === wp.id) setPendingEdgeFrom(null);
  }

  function deletePoi(poi: POI) {
    commit({ ...graph, pois: graph.pois.filter((p) => p.id !== poi.id) });
    if (draftEditingId === poi.id) {
      setDraft(null);
      setDraftEditingId(null);
    }
  }

  function focusOn(x: number, y: number) {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({
      left: x - container.clientWidth / 2,
      top: y - container.clientHeight / 2,
      behavior: 'smooth',
    });
  }

  async function handleSave() {
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/floorplans/${planId}/graph`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(graph),
      });
      if (!res.ok) throw new Error('save failed');
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2000);
    } catch {
      setSaveStatus('error');
    }
  }

  if (previewMode) {
    return <WayfinderView graph={graph} imageUrl={imageUrl} onExitPreview={() => setPreviewMode(false)} />;
  }

  return (
    <div className="flex h-screen flex-col">
      <Toolbar
        tool={tool}
        onToolChange={(t) => {
          setTool(t);
          setPendingEdgeFrom(null);
        }}
        onUndo={undo}
        onRedo={redo}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onSave={handleSave}
        saveStatus={saveStatus}
        previewMode={previewMode}
        onTogglePreview={() => setPreviewMode(true)}
      />

      <div className="flex min-h-0 flex-1">
        <div ref={containerRef} className="relative flex-1 overflow-auto bg-slate-200">
          <div
            ref={wrapperRef}
            onClick={handleCanvasClick}
            className="relative"
            style={{ width: imageWidth, height: imageHeight, cursor: tool === 'select' ? 'default' : 'crosshair' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={graph.floorPlan.name} width={imageWidth} height={imageHeight} draggable={false} className="select-none" />
            <svg viewBox={`0 0 ${imageWidth} ${imageHeight}`} width={imageWidth} height={imageHeight} className="absolute inset-0">
              {graph.edges.map((edge, i) => {
                const from = graph.waypoints.find((w) => w.id === edge.from);
                const to = graph.waypoints.find((w) => w.id === edge.to);
                if (!from || !to) return null;
                return (
                  <line
                    key={i}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke="#94a3b8"
                    strokeWidth={Math.max(2, imageWidth / 400)}
                  />
                );
              })}

              {graph.waypoints.map((wp) => (
                <circle
                  key={wp.id}
                  cx={wp.x}
                  cy={wp.y}
                  r={waypointRadius}
                  fill={pendingEdgeFrom === wp.id ? '#f59e0b' : '#64748b'}
                  stroke="white"
                  strokeWidth={1.5}
                />
              ))}

              {graph.pois.map((poi) => (
                <g key={poi.id} transform={`translate(${poi.x} ${poi.y})`}>
                  {draftEditingId === poi.id && (
                    <circle r={poiRadius + 5} fill="none" stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="4 3" />
                  )}
                  <circle r={poiRadius} fill={CATEGORY_FILL[poi.category]} stroke="white" strokeWidth={2} />
                  {poi.isEntrance && <circle r={poiRadius + 3} fill="none" stroke="#0ea5e9" strokeWidth={2} />}
                  <text
                    y={-poiRadius - 5}
                    textAnchor="middle"
                    fontSize={Math.max(10, imageWidth / 150)}
                    fill="#1e293b"
                    stroke="white"
                    strokeWidth={3}
                    paintOrder="stroke"
                    className="pointer-events-none select-none font-medium"
                  >
                    {poi.name}
                  </text>
                </g>
              ))}

              {draft && !draftEditingId && (
                <circle cx={draft.x} cy={draft.y} r={poiRadius} fill="none" stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="4 3" />
              )}
            </svg>
          </div>
        </div>

        <EntityPanel
          graph={graph}
          onFocus={focusOn}
          onDeleteWaypoint={deleteWaypoint}
          onDeletePoi={deletePoi}
          onEditPoi={openEditForm}
        />
      </div>

      {draft && (
        <POIForm
          draft={draft}
          waypoints={graph.waypoints}
          isEditing={!!draftEditingId}
          onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
          onSave={saveDraft}
          onCancel={cancelDraft}
          onDelete={draftEditingId ? deleteDraft : undefined}
        />
      )}
    </div>
  );
}
