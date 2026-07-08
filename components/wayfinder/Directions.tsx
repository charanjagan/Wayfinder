'use client';

import type { DirectionStep } from '@/lib/directions';

export default function Directions({ steps, totalLabel }: { steps: DirectionStep[]; totalLabel: string }) {
  if (steps.length === 0) {
    return (
      <div className="border border-border bg-white p-4 text-sm text-ink/50">
        Search or click a location on the map to get directions.
      </div>
    );
  }

  return (
    <div className="border border-border bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">Directions · {totalLabel}</div>
      <ol className="mt-2 space-y-2">
        {steps.map((step, i) => (
          <li key={i} className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-b-0 last:pb-0">
            <span>
              <span className="mr-2 inline-block w-4 text-ink/40">{i + 1}.</span>
              {step.instruction}
            </span>
            {step.distanceLabel && <span className="text-ink/50">{step.distanceLabel}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
