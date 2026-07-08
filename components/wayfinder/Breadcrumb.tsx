'use client';

export default function Breadcrumb({ destinationName }: { destinationName: string | null }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-white px-4 py-2.5 text-sm">
      <span className="inline-block h-2 w-2 rounded-full bg-accent" />
      <span className="font-medium">You are here</span>
      <span className="text-ink/30">→</span>
      <span
        key={destinationName ?? 'none'}
        className={`font-medium transition-opacity duration-300 ${destinationName ? 'text-accent' : 'text-ink/40'}`}
      >
        {destinationName ?? 'Search or select a destination'}
      </span>
    </div>
  );
}
