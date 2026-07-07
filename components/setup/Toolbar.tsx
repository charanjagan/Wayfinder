'use client';

import Link from 'next/link';
import type { Tool } from './SetupEditor';

export default function Toolbar({
  tool,
  onToolChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSave,
  saveStatus,
  previewMode,
  onTogglePreview,
  onResetZoom,
}: {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onSave: () => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  previewMode: boolean;
  onTogglePreview: () => void;
  onResetZoom: () => void;
}) {
  const tools: { id: Tool; label: string }[] = [
    { id: 'select', label: 'Select' },
    { id: 'zone', label: 'Zone' },
    { id: 'here', label: 'You Are Here' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
      <div className="flex overflow-hidden rounded-lg border border-slate-300">
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => onToolChange(t.id)}
            className={`px-3 py-1.5 text-sm font-medium ${
              tool === t.id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          Undo
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          Redo
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Link href="/admin" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          ← Admin
        </Link>
        <button
          onClick={onResetZoom}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Reset zoom
        </button>
        <button
          onClick={onTogglePreview}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          {previewMode ? 'Back to editing' : 'Preview wayfinder'}
        </button>
        <button
          onClick={onSave}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {saveStatus === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {saveStatus === 'saved' && <span className="text-xs text-emerald-600">Saved</span>}
        {saveStatus === 'error' && <span className="text-xs text-red-600">Save failed</span>}
      </div>
    </div>
  );
}
