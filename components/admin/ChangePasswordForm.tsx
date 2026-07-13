'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to change password.');
      router.push('/setup/new');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label className="mb-3 block text-sm text-ink/70">
        Current password
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="mt-1 w-full border border-border px-3 py-2"
          autoFocus
        />
      </label>
      <label className="mb-4 block text-sm text-ink/70">
        New password (min 8 characters)
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="mt-1 w-full border border-border px-3 py-2"
        />
      </label>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-accent px-3 py-2 text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
