// The Pulse topology edges, shared by TopologyMap (draws them) and the phone
// layout (flashes the LEDs at both ends of a lit edge instead of drawing it).
interface EdgeDef {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  weight: "spine" | "secondary";
}

// Matches the approved mockup's topology exactly (mission-control.html).
export const PULSE_EDGES: EdgeDef[] = [
  { id: "ibkr-gateway", fromNodeId: "ibkr", toNodeId: "gateway", weight: "spine" },
  { id: "heroku-gateway", fromNodeId: "heroku", toNodeId: "gateway", weight: "spine" },
  { id: "heroku-browser", fromNodeId: "heroku", toNodeId: "frontend", weight: "spine" },
  { id: "gateway-db", fromNodeId: "gateway", toNodeId: "db", weight: "secondary" },
  { id: "heroku-genosuke", fromNodeId: "heroku", toNodeId: "genosuke", weight: "secondary" },
  { id: "genosuke-db", fromNodeId: "genosuke", toNodeId: "db", weight: "secondary" },
  { id: "heroku-db", fromNodeId: "heroku", toNodeId: "db", weight: "secondary" },
  { id: "genosuke-llm", fromNodeId: "genosuke", toNodeId: "llm", weight: "secondary" },
];

/** Both endpoints of every edge currently lit — the phone layout flashes those nodes' LEDs instead of drawing the edges. */
export function nodeIdsForActiveEdges(activeEdgeIds: Set<string>): Set<string> {
  const nodeIds = new Set<string>();
  for (const edge of PULSE_EDGES) {
    if (!activeEdgeIds.has(edge.id)) continue;
    nodeIds.add(edge.fromNodeId);
    nodeIds.add(edge.toNodeId);
  }
  return nodeIds;
}
