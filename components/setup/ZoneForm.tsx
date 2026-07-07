'use client';

import { useState } from 'react';

export default function ZoneForm({ onSave, onCancel }: { onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
  }

  return (
    <div className="fixed bottom-4 right-[19rem] z-30 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">New zone</h3>
      <label className="mb-3 block text-xs font-medium text-slate-500">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          autoFocus
          placeholder="e.g. Zone J"
          className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        />
      </label>
      <div className="flex gap-2">
        <button onClick={handleSave} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
          Save
        </button>
        <button onClick={onCancel} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
