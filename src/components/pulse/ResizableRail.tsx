import { Children, useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

const MINIMUM_PANEL_PERCENT = 20;
const KEYBOARD_STEP_PERCENT = 2;
const DEFAULT_TOP_PERCENT = 50;

function clampTopPercent(percent: number): number {
  return Math.min(100 - MINIMUM_PANEL_PERCENT, Math.max(MINIMUM_PANEL_PERCENT, percent));
}

function readStoredTopPercent(storageKey: string): number {
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? clampTopPercent(stored) : DEFAULT_TOP_PERCENT;
  } catch {
    return DEFAULT_TOP_PERCENT;
  }
}

function writeStoredTopPercent(storageKey: string, percent: number | null) {
  try {
    if (percent === null) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, String(percent));
  } catch {
    // Storage unavailable — the split just won't persist.
  }
}

/**
 * A Pulse side rail of exactly two panel children with a draggable divider between
 * them. The split is the top panel's share of the rail (a percentage, so it
 * holds across screen sizes) and is remembered per rail in localStorage.
 * Double-click resets to 50/50. Desktop only: the handle is hidden and the
 * split ignored at phone width (see PulsePage.css).
 */
export function ResizableRail({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const [topPanel, bottomPanel] = Children.toArray(children);
  const railReference = useRef<HTMLDivElement>(null);
  const [topPercent, setTopPercent] = useState(() => readStoredTopPercent(storageKey));

  // Dragging moves the split by the pointer's travel since pointer-down, so a
  // plain click (or the clicks of a double-click) never shifts the divider.
  const dragStart = useRef<{ pointerY: number; topPercent: number } | null>(null);

  const updateFromPointer = useCallback((event: PointerEvent<HTMLDivElement>): number | null => {
    const rail = railReference.current;
    const start = dragStart.current;
    if (!rail || !start) return null;
    const bounds = rail.getBoundingClientRect();
    if (bounds.height <= 0) return null;
    const percent = clampTopPercent(start.topPercent + ((event.clientY - start.pointerY) / bounds.height) * 100);
    setTopPercent(percent);
    return percent;
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { pointerY: event.clientY, topPercent };
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
  };
  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const percent = updateFromPointer(event);
    const startingPercent = dragStart.current?.topPercent;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragStart.current = null;
    if (percent !== null && percent !== startingPercent) writeStoredTopPercent(storageKey, percent);
  };
  const handleDoubleClick = () => {
    setTopPercent(DEFAULT_TOP_PERCENT);
    writeStoredTopPercent(storageKey, null);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const next = clampTopPercent(topPercent + (event.key === "ArrowDown" ? KEYBOARD_STEP_PERCENT : -KEYBOARD_STEP_PERCENT));
    setTopPercent(next);
    writeStoredTopPercent(storageKey, next);
  };

  return (
    <div className="rail" ref={railReference} style={{ "--rail-top-share": topPercent, "--rail-bottom-share": 100 - topPercent } as React.CSSProperties}>
      {topPanel}
      <div
        className="rail-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-valuemin={MINIMUM_PANEL_PERCENT}
        aria-valuemax={100 - MINIMUM_PANEL_PERCENT}
        aria-valuenow={Math.round(topPercent)}
        aria-label="Resize panels (double-click to reset)"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      />
      {bottomPanel}
    </div>
  );
}
