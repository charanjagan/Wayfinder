'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

const STAGE_LABELS: Record<string, string> = {
  rasterizing: 'Rasterizing PDF…',
  building_grid: 'Building occupancy grid…',
  extracting_labels: 'Extracting labels…',
  detecting_zones: 'Detecting zones…',
  done: 'Done!',
};

const STAGE_ORDER = ['rasterizing', 'building_grid', 'extracting_labels', 'detecting_zones', 'done'];

export default function UploadCard({ redirectTo = '/' }: { redirectTo?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setStage('rasterizing');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/ingest', { method: 'POST', body: formData });
      if (!res.body) throw new Error('No response from server.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let doneId: string | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { stage: string; message?: string; id?: string };
          if (event.stage === 'error') {
            throw new Error(event.message ?? 'Upload failed.');
          }
          setStage(event.stage);
          if (event.stage === 'done' && event.id) {
            doneId = event.id;
          }
        }
      }

      if (!doneId) throw new Error('Ingestion did not complete.');
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
      setStage(null);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload(file);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !stage && inputRef.current?.click()}
      className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
        dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:border-slate-400'
      }`}
    >
      <input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handlePick} />
      {stage ? (
        <div>
          <p className="text-slate-700">{STAGE_LABELS[stage] ?? stage}</p>
          <ul className="mt-4 flex justify-center gap-2 text-xs text-slate-400">
            {STAGE_ORDER.map((s) => (
              <li key={s} className={STAGE_ORDER.indexOf(s) <= STAGE_ORDER.indexOf(stage) ? 'text-indigo-600' : ''}>
                {STAGE_LABELS[s]}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <p className="text-lg font-medium text-slate-700">Drop a floor plan PDF here</p>
          <p className="mt-1 text-sm text-slate-500">or click to browse</p>
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
