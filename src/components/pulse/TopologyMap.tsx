import { useEffect, useRef, type ReactNode } from "react";

export interface PulseEvent {
  key: string;
  edgeId: string;
  color: string;
  reverse?: boolean;
  durationMs?: number;
}

interface EdgeDef {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  weight: "spine" | "secondary";
}

// Matches the approved mockup's topology exactly (mission-control.html) —
// see PulsePage.tsx for how each node's real data is sourced.
const PULSE_EDGES: EdgeDef[] = [
  { id: "ibkr-gateway", fromNodeId: "ibkr", toNodeId: "gateway", weight: "spine" },
  { id: "heroku-gateway", fromNodeId: "heroku", toNodeId: "gateway", weight: "spine" },
  { id: "heroku-browser", fromNodeId: "heroku", toNodeId: "frontend", weight: "spine" },
  { id: "gateway-db", fromNodeId: "gateway", toNodeId: "db", weight: "secondary" },
  { id: "heroku-genosuke", fromNodeId: "heroku", toNodeId: "genosuke", weight: "secondary" },
  { id: "genosuke-db", fromNodeId: "genosuke", toNodeId: "db", weight: "secondary" },
  { id: "heroku-db", fromNodeId: "heroku", toNodeId: "db", weight: "secondary" },
  { id: "genosuke-llm", fromNodeId: "genosuke", toNodeId: "llm", weight: "secondary" },
];

interface TopologyMapProps {
  /** Node card markup — each top-level node element must carry data-node-id matching PULSE_EDGES' from/toNodeId. */
  children: ReactNode;
  /** Currently in-flight pulses to animate — PulsePage owns their lifecycle (add on notification, remove after durationMs). */
  pulses: PulseEvent[];
  /** Edge ids that should render "active" (glowing) right now — kept in sync with `pulses` by the caller. */
  activeEdgeIds: Set<string>;
}

// Ports the approved mockup's geometry approach (mission-control.html lines
// ~522-574): real DOM node centers via getBoundingClientRect, cubic-bezier
// connector paths drawn at true 1:1 pixel scale (the earlier mockup round
// hit a real text-scaling bug from a stretched abstract viewBox — this
// avoids that class of bug entirely), small colored circles animated via
// animateMotion/mpath along the path. Plain circles, no text labels — per
// the mockup-review round where labels were found unreadable.
export function TopologyMap({ children, pulses, activeEdgeIds }: TopologyMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});

  useEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    if (!wrap || !svg) return;

    function getCenter(nodeId: string, containerRect: DOMRect): { x: number; y: number } | null {
      const el = wrap!.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - containerRect.left, y: r.top + r.height / 2 - containerRect.top };
    }

    function draw() {
      const rect = wrap!.getBoundingClientRect();
      svg!.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
      for (const edge of PULSE_EDGES) {
        const a = getCenter(edge.fromNodeId, rect);
        const b = getCenter(edge.toNodeId, rect);
        const pathEl = pathRefs.current[edge.id];
        if (!a || !b || !pathEl) continue;
        const dx = b.x - a.x;
        const c1x = a.x + dx * 0.5;
        const c2x = b.x - dx * 0.5;
        pathEl.setAttribute("d", `M ${a.x} ${a.y} C ${c1x} ${a.y}, ${c2x} ${b.y}, ${b.x} ${b.y}`);
      }
    }

    draw();
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(wrap);
    return () => resizeObserver.disconnect();
  }, [children]);

  return (
    <div className="map-wrap" ref={wrapRef}>
      <svg className="map-svg" ref={svgRef}>
        {PULSE_EDGES.map((edge) => (
          <path
            key={edge.id}
            id={`pulse-path-${edge.id}`}
            ref={(el) => {
              pathRefs.current[edge.id] = el;
            }}
            className={`edge ${edge.weight}${activeEdgeIds.has(edge.id) ? " edge-active" : ""}`}
          />
        ))}
        {pulses.map((pulse) => (
          <circle key={pulse.key} r={2.8} className="packet-dot" fill={pulse.color} style={{ color: pulse.color }}>
            <animateMotion
              dur={`${(pulse.durationMs ?? 300) / 1000}s`}
              repeatCount={1}
              fill="freeze"
              keyPoints={pulse.reverse ? "1;0" : undefined}
              keyTimes={pulse.reverse ? "0;1" : undefined}
            >
              <mpath href={`#pulse-path-${pulse.edgeId}`} />
            </animateMotion>
          </circle>
        ))}
      </svg>
      {children}
    </div>
  );
}
