export interface DirectionStep {
  instruction: string;
  distanceLabel: string;
}

function formatDistance(px: number, pixelToMm: number | null): string {
  if (pixelToMm) {
    const meters = (px * pixelToMm) / 1000;
    return meters < 1 ? `${Math.round(meters * 100)} cm` : `${meters.toFixed(1)} m`;
  }
  return `${Math.round(px)} px`;
}

/** Turns a simplified waypoint list (start .. Douglas-Peucker corners .. end) into
 * turn-by-turn text: a heading change between consecutive segments of less than 20deg
 * reads as "continue straight", otherwise as a left/right turn (sign follows screen-space
 * y-down convention: a positive angle delta is a clockwise/right turn). */
export function buildDirections(points: { x: number; y: number }[], pixelToMm: number | null): DirectionStep[] {
  const segments: { dx: number; dy: number; length: number }[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const length = Math.hypot(dx, dy);
    if (length >= 1) segments.push({ dx, dy, length });
  }
  if (segments.length === 0) return [];

  const steps: DirectionStep[] = [
    { instruction: 'Head straight ahead', distanceLabel: formatDistance(segments[0].length, pixelToMm) },
  ];

  for (let i = 1; i < segments.length; i += 1) {
    const prev = segments[i - 1];
    const cur = segments[i];
    const angle1 = Math.atan2(prev.dy, prev.dx);
    const angle2 = Math.atan2(cur.dy, cur.dx);
    let diff = ((angle2 - angle1) * 180) / Math.PI;
    diff = ((diff + 180) % 360 + 360) % 360 - 180;

    let instruction: string;
    if (Math.abs(diff) < 20) instruction = 'Continue straight';
    else if (diff >= 20 && diff < 160) instruction = 'Turn right';
    else if (diff <= -20 && diff > -160) instruction = 'Turn left';
    else instruction = 'Turn around';

    steps.push({ instruction, distanceLabel: formatDistance(cur.length, pixelToMm) });
  }

  steps.push({ instruction: 'Arrive at destination', distanceLabel: '' });
  return steps;
}

export function formatTotalDistance(distancePx: number, pixelToMm: number | null): string {
  return formatDistance(distancePx, pixelToMm);
}
