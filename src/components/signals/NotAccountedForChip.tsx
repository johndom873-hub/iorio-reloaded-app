import { useEffect, useRef, useState } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { RoadmapEta, RoadmapItem } from "../../api/signals";
import { formatDate } from "../../lib/formatters";
import { roadmapStatusBadgeClass, roadmapStatusLabel, signalsColumnExplanation } from "../../lib/signalsPresentation";
import { Spinner } from "../Spinner";

const badgeFontSize = { fontSize: "0.72rem" } as const;

export function RoadmapEtaText({ eta }: { eta: RoadmapEta }) {
  const progress = eta.progress ? (
    <span className="text-secondary ms-1" style={{ fontSize: "0.72rem" }}>
      ({eta.progress.have}/{eta.progress.need} {eta.progress.unit})
    </span>
  ) : null;
  return (
    <>
      <span className={`fw-semibold ${eta.kind === "date" ? "font-mono" : ""}`}>{eta.kind === "date" ? formatDate(eta.dateIso) : eta.text}</span>
      {progress}
    </>
  );
}

// Positioned against the viewport (not the cell): a table scrolls horizontally inside
// .table-responsive, whose overflow would clip a menu anchored inside it. Opens on
// whichever side has more room and follows the button on page scroll. (Closing on
// every scroll event was tried first: the live re-render fires scroll events inside
// the table every second and shut the menu at once.)
const popoverWidthPx = 384;
const popoverViewportMarginPx = 8;
type PopoverPlacement = { top?: number; bottom?: number; right: number; maxHeight: number };
function placementFor(button: HTMLElement): PopoverPlacement {
  const rect = button.getBoundingClientRect();
  const right = Math.max(popoverViewportMarginPx, window.innerWidth - rect.right);
  const roomBelow = window.innerHeight - rect.bottom - popoverViewportMarginPx;
  const roomAbove = rect.top - popoverViewportMarginPx;
  const opensUpward = roomAbove > roomBelow;
  const maxHeight = Math.min(window.innerHeight * 0.6, opensUpward ? roomAbove : roomBelow);
  return opensUpward ? { bottom: window.innerHeight - rect.top + 4, right, maxHeight } : { top: rect.bottom + 4, right, maxHeight };
}

interface NotAccountedForChipProps {
  symbol: string;
  caveats: RoadmapItem[];
  generalItems: RoadmapItem[];
  /** Chip text when the ticker has no specific caveat; defaults to "N general". */
  label?: string;
  /** Starts the history backfill for this ticker; shown as a button on the suspected-split caveat. */
  onBackfillHistory?: () => void;
  backfillStarting?: boolean;
}

export function NotAccountedForChip({ symbol, caveats, generalItems, label, onBackfillHistory, backfillStarting = false }: NotAccountedForChipProps) {
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isOpen = placement !== null;
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setPlacement(null);
    }
    function follow() {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      setPlacement(rect.bottom < 0 || rect.top > window.innerHeight ? null : placementFor(button));
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", follow);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", follow);
      window.removeEventListener("resize", follow);
    };
  }, [isOpen]);

  const specificCount = caveats.length;
  return (
    <div ref={containerRef} style={{ display: "inline-block" }}>
      <button
        ref={buttonRef}
        type="button"
        className={`badge border-0 d-inline-flex align-items-center gap-1 px-2 py-1 ${specificCount > 0 ? "bg-warning-lt" : "bg-secondary-lt"}`}
        style={{ ...badgeFontSize, cursor: "pointer" }}
        title={signalsColumnExplanation.notAccountedFor}
        onClick={(event) => setPlacement(isOpen ? null : placementFor(event.currentTarget))}
      >
        <IconAlertTriangle size={12} />
        {label ?? `${specificCount > 0 ? `${specificCount} specific + ` : ""}${generalItems.length} general`}
      </button>
      <div className={`dropdown-menu p-3 ${isOpen ? "show" : ""}`} style={{ position: "fixed", ...placement, width: `${popoverWidthPx}px`, maxWidth: "calc(100vw - 2rem)", overflowY: "auto", whiteSpace: "normal", zIndex: 1100 }}>
        <div className="fw-semibold mb-2">{symbol}: not accounted for</div>
        {caveats.length === 0 ? (
          <div className="text-secondary mb-2" style={{ fontSize: "0.8rem" }}>
            Nothing specific to this ticker.
          </div>
        ) : (
          caveats.map((caveat) => (
            <div key={caveat.id} className="mb-2">
              <div className="fw-semibold" style={{ fontSize: "0.8rem" }}>
                {caveat.title}
              </div>
              <div className="text-secondary" style={{ fontSize: "0.78rem" }}>
                {caveat.summary} Needs: {caveat.needs}
              </div>
              <div style={{ fontSize: "0.78rem" }}>
                <span className={`badge ${roadmapStatusBadgeClass[caveat.status]} me-1`} style={badgeFontSize}>
                  {roadmapStatusLabel[caveat.status]}
                </span>
                <RoadmapEtaText eta={caveat.eta} />
              </div>
              {caveat.id === "suspected_split" && onBackfillHistory && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary mt-1 d-inline-flex align-items-center gap-1"
                  disabled={backfillStarting}
                  onClick={() => {
                    setPlacement(null);
                    onBackfillHistory();
                  }}
                >
                  {backfillStarting && <Spinner size="sm" />}
                  Backfill history
                </button>
              )}
            </div>
          ))
        )}
        <div className="border-top pt-2">
          <div className="fw-semibold" style={{ fontSize: "0.8rem" }}>
            Applies to every ticker ({generalItems.length})
          </div>
          <div className="text-secondary" style={{ fontSize: "0.78rem" }}>
            {generalItems.map((item) => (
              <div key={item.id}>
                {item.title} ({item.eta.kind === "date" ? formatDate(item.eta.dateIso) : item.eta.text})
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
