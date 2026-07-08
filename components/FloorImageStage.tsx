'use client';

import { useEffect, useRef, useState } from 'react';

export interface NaturalSize {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

interface Props {
  floorId: string;
  hasImage: boolean;
  version?: number;
  onNaturalSize?: (size: NaturalSize) => void;
  onClickImage?: (point: Point) => void;
  overlay?: (natural: NaturalSize) => React.ReactNode;
  cursor?: string;
  /** When set, renders these as draggable handles over the image; dragging one
   * calls onEditablePointsChange with the full updated array. Used for zone
   * reshape / POI move. */
  editablePoints?: Point[];
  onEditablePointsChange?: (points: Point[]) => void;
}

/** Renders a floor plan image with an SVG overlay locked to its natural pixel
 * coordinate space, so overlay children (zones, POIs, paths) never need their
 * own scale math -- they draw in image pixels regardless of on-screen size. */
export default function FloorImageStage({
  floorId,
  hasImage,
  version,
  onNaturalSize,
  onClickImage,
  overlay,
  cursor,
  editablePoints,
  onEditablePointsChange,
}: Props) {
  const [natural, setNatural] = useState<NaturalSize | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const reportSize = (img: HTMLImageElement) => {
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    setNatural(size);
    onNaturalSize?.(size);
  };

  // The <img> is already in the server-rendered HTML, so the browser can finish
  // loading it (small floor plan images especially) before React hydrates and
  // attaches onLoad -- that fires the native 'load' event before any listener
  // exists, so it's silently missed forever without this complete-on-mount check.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      reportSize(img);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorId, version]);

  const clientToNatural = (clientX: number, clientY: number): Point | null => {
    if (!natural || !wrapperRef.current) return null;
    const rect = wrapperRef.current.getBoundingClientRect();
    const xRatio = (clientX - rect.left) / rect.width;
    const yRatio = (clientY - rect.top) / rect.height;
    return { x: xRatio * natural.width, y: yRatio * natural.height };
  };

  // Dragging a handle can carry the pointer outside the wrapper's bounds, so the
  // move/up listeners are attached to the window for the duration of the drag
  // rather than relying on the wrapper's own mouse events.
  useEffect(() => {
    if (dragIndex === null) return;
    const handleMove = (e: MouseEvent) => {
      const point = clientToNatural(e.clientX, e.clientY);
      if (!point || !editablePoints || !onEditablePointsChange) return;
      const next = editablePoints.map((p, i) => (i === dragIndexRef.current ? point : p));
      onEditablePointsChange(next);
    };
    const handleUp = () => {
      dragIndexRef.current = null;
      setDragIndex(null);
      suppressClickRef.current = true;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragIndex, editablePoints]);

  if (!hasImage) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center border border-dashed border-border bg-white text-sm text-ink/50">
        No floor plan uploaded yet.
      </div>
    );
  }

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    reportSize(e.currentTarget);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!natural || !onClickImage) return;
    const point = clientToNatural(e.clientX, e.clientY);
    if (point) onClickImage(point);
  };

  return (
    <div
      ref={wrapperRef}
      className="relative w-full max-w-full border border-border bg-white"
      style={{
        aspectRatio: natural ? `${natural.width} / ${natural.height}` : undefined,
        cursor: cursor ?? 'default',
      }}
      onClick={handleClick}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={`/api/floors/${floorId}/image${version ? `?v=${version}` : ''}`}
        onLoad={handleLoad}
        alt="Floor plan"
        className="absolute inset-0 h-full w-full object-fill"
        draggable={false}
      />
      {natural && (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${natural.width} ${natural.height}`}
          preserveAspectRatio="none"
        >
          {overlay?.(natural)}
          {editablePoints?.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={Math.max(5, natural.width * 0.005)}
              fill="#2954D9"
              stroke="#ffffff"
              strokeWidth={1.5}
              style={{ cursor: 'grab' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                dragIndexRef.current = i;
                setDragIndex(i);
              }}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
