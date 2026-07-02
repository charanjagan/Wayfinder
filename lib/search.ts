import type { POI } from './types';

function matchScore(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return null;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.includes(q)) return 2;

  // subsequence fuzzy match: every char of q appears in order in t
  let ti = 0;
  let gaps = 0;
  for (let qi = 0; qi < q.length; qi += 1) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return null;
    gaps += found - ti;
    ti = found + 1;
  }
  return 3 + gaps;
}

export function searchPois(pois: POI[], query: string): POI[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const scored = pois
    .map((poi) => {
      const candidates = [poi.name, ...(poi.aliases ?? [])];
      const scores = candidates
        .map((c) => matchScore(c, trimmed))
        .filter((s): s is number => s !== null);
      if (scores.length === 0) return null;
      return { poi, score: Math.min(...scores) };
    })
    .filter((r): r is { poi: POI; score: number } => r !== null);

  scored.sort((a, b) => a.score - b.score || a.poi.name.localeCompare(b.poi.name));
  return scored.map((r) => r.poi);
}
