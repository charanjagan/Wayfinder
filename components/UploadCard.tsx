'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

export default function UploadCard({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/floorplans', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Upload failed.');
      }
      router.push(`/plan/${data.id}/setup`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
      setUploading(false);
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
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
        dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:border-slate-400'
      } ${compact ? 'p-6' : 'p-10'}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,image/png,image/jpeg,application/pdf"
        className="hidden"
        onChange={handlePick}
      />
      {uploading ? (
        <p className="text-slate-600">Processing floor plan…</p>
      ) : (
        <>
          <p className="text-lg font-medium text-slate-700">
            {compact ? 'Upload a new floor plan' : 'Drop a floor plan here'}
          </p>
          <p className="mt-1 text-sm text-slate-500">PDF, PNG, or JPG — or click to browse</p>
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
