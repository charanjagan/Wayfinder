'use client';

import { useEffect, useState } from 'react';
import type { OccupancyGrid } from '@/lib/types';
import type { NaturalSize } from '../FloorImageStage';

/** Rasterizes the occupancy grid (wall/walkable per cell) to a small bitmap once,
 * then lets the browser upscale it over the full-res image -- cheap, and the
 * blocky pixelated look usefully communicates "this is the debug grid, not the plan". */
export default function GridOverlay({ grid, natural }: { grid: OccupancyGrid; natural: NaturalSize }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = grid.width;
    canvas.height = grid.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.createImageData(grid.width, grid.height);
    for (let row = 0; row < grid.height; row += 1) {
      for (let col = 0; col < grid.width; col += 1) {
        const idx = (row * grid.width + col) * 4;
        const isWall = grid.grid[row][col] === 1;
        imageData.data[idx] = 41; // ink-ish red channel
        imageData.data[idx + 1] = 50;
        imageData.data[idx + 2] = 56;
        imageData.data[idx + 3] = isWall ? 130 : 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    setDataUrl(canvas.toDataURL());
  }, [grid]);

  if (!dataUrl) return null;

  return (
    <image
      href={dataUrl}
      x={0}
      y={0}
      width={natural.width}
      height={natural.height}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
