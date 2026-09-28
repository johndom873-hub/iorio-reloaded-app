import { Children, useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

const MINIMUM_RAIL_WIDTH_PX = 220;
const MAXIMUM_RAIL_WIDTH_PX = 420;
const DEFAULT_RAIL_WIDTH_PX = 292;
const KEYBOARD_STEP_PX = 16;

type Side = "left" | "right";

function clampPercentToPxRange(percent: number, containerWidthPx: number): number {
  if (containerWidthPx <= 0) return percent;
  const minimumPercent = (MINIMUM_RAIL_WIDTH_PX / containerWidthPx) * 100;
  const maximumPercent = (MAXIMUM_RAIL_WIDTH_PX / containerWidthPx) * 100;
  return Math.min(maximumPercent, Math.max(minimumPercent, percent));
}

function readStoredPercent(storageKey: string): number | null {
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredPercent(storageKey: string, percent: number | null) {
  try {
    if (percent === null) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, String(percent));
  } catch {
    // Storage unavailable — the split just won't persist.
  }
}

/**
 * The Pulse dashboard's 3-column grid (left rail, chart, right rail) with a
 * draggable divider on each side of the chart. Each rail's width is stored as
 * a percentage of the grid's width (so the split holds across window
 * resizes) and clamped to 220–420px via CSS so a rail can't get unreadably
 * narrow or crowd out the chart. Persisted per side in localStorage;
 * double-click resets that side to its default width. Desktop only — the
 * dividers hide at phone width (see PulsePage.css).
 */
export function ResizableColumns({
  leftStorageKey,
  rightStorageKey,
  children,
}: {
  leftStorageKey: string;
  rightStorageKey: string;
  children: ReactNode;
}) {
  const [leftChild, centerChild, rightChild] = Children.toArray(children);
  const gridReference = useRef<HTMLDivElement>(null);

  const [leftPercent, setLeftPercent] = useState<number | null>(() => readStoredPercent(leftStorageKey));
  const [rightPercent, setRightPercent] = useState<number | null>(() => readStoredPercent(rightStorageKey));

  // Dragging moves the split by the pointer's travel since pointer-down, so a
  // plain click (or the clicks of a double-click) never shifts the divider.
  const dragStart = useRef<{ pointerX: number; percent: number; side: Side } | null>(null);

  const storageKeyForSide = (side: Side) => (side === "left" ? leftStorageKey : rightStorageKey);
  const setPercentForSide = (side: Side, percent: number | null) => {
    if (side === "left") setLeftPercent(percent);
    else setRightPercent(percent);
  };

  const updateFromPointer = useCallback((event: PointerEvent<HTMLDivElement>): number | null => {
    const grid = gridReference.current;
    const start = dragStart.current;
    if (!grid || !start) return null;
    const width = grid.getBoundingClientRect().width;
    if (width <= 0) return null;
    const deltaPercent = ((event.clientX - start.pointerX) / width) * 100;
    const rawPercent = start.side === "left" ? start.percent + deltaPercent : start.percent - deltaPercent;
    const percent = clampPercentToPxRange(rawPercent, width);
    setPercentForSide(start.side, percent);
    return percent;
  }, []);

  const handlePointerDown = (side: Side) => (event: PointerEvent<HTMLDivElement>) => {
    const grid = gridReference.current;
    if (!grid) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const width = grid.getBoundingClientRect().width;
    const currentPercent = side === "left" ? leftPercent : rightPercent;
    const percent = currentPercent ?? (width > 0 ? (DEFAULT_RAIL_WIDTH_PX / width) * 100 : 0);
    dragStart.current = { pointerX: event.clientX, percent, side };
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
  };
  const handlePointerUp = (side: Side) => (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const percent = updateFromPointer(event);
    const startingPercent = dragStart.current?.percent;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragStart.current = null;
    if (percent !== null && percent !== startingPercent) writeStoredPercent(storageKeyForSide(side), percent);
  };
  const handleDoubleClick = (side: Side) => () => {
    setPercentForSide(side, null);
    writeStoredPercent(storageKeyForSide(side), null);
  };
  const handleKeyDown = (side: Side) => (event: KeyboardEvent<HTMLDivElement>) => {
    const isGrow = side === "left" ? event.key === "ArrowRight" : event.key === "ArrowLeft";
    const isShrink = side === "left" ? event.key === "ArrowLeft" : event.key === "ArrowRight";
    if (!isGrow && !isShrink) return;
    event.preventDefault();
    const width = gridReference.current?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    const currentPercent = (side === "left" ? leftPercent : rightPercent) ?? (DEFAULT_RAIL_WIDTH_PX / width) * 100;
    const stepPercent = (KEYBOARD_STEP_PX / width) * 100;
    const next = clampPercentToPxRange(currentPercent + (isGrow ? stepPercent : -stepPercent), width);
    setPercentForSide(side, next);
    writeStoredPercent(storageKeyForSide(side), next);
  };

  const gridStyle = {
    ...(leftPercent !== null ? { "--left-rail-width": `${leftPercent}%` } : {}),
    ...(rightPercent !== null ? { "--right-rail-width": `${rightPercent}%` } : {}),
  } as CSSProperties;

  return (
    <div className="main-grid" ref={gridReference} style={gridStyle}>
      {leftChild}
      <div
        className="column-divider column-divider--left"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize left panel (double-click to reset)"
        tabIndex={0}
        onPointerDown={handlePointerDown("left")}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp("left")}
        onDoubleClick={handleDoubleClick("left")}
        onKeyDown={handleKeyDown("left")}
      />
      {centerChild}
      <div
        className="column-divider column-divider--right"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right panel (double-click to reset)"
        tabIndex={0}
        onPointerDown={handlePointerDown("right")}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp("right")}
        onDoubleClick={handleDoubleClick("right")}
        onKeyDown={handleKeyDown("right")}
      />
      {rightChild}
    </div>
  );
}
