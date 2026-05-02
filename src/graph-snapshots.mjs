function normalize(value, maxLength = 0) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return maxLength && text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function slug(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "graph";
}

function compactNode(node = {}) {
  return {
    id: normalize(node.id, 160),
    type: normalize(node.type, 80),
    label: normalize(node.label, 180),
    strength: Number(node.strength ?? node.weight ?? 0),
    state: normalize(node.state || node.schema_state, 80),
  };
}

function compactEdge(edge = {}) {
  return {
    id: normalize(edge.id, 180) || `${normalize(edge.from, 120)}->${normalize(edge.to, 120)}:${normalize(edge.type, 80)}`,
    from: normalize(edge.from, 160),
    to: normalize(edge.to, 160),
    type: normalize(edge.type, 80),
    weight: Number(edge.weight ?? edge.confidence ?? 0),
    evidence_ids: Array.isArray(edge.evidence_ids)
      ? edge.evidence_ids.map((id) => normalize(id, 120)).filter(Boolean).slice(0, 10)
      : [],
  };
}

function graphFromStore(memoryStore = {}) {
  const graph = memoryStore.graph || {};
  return {
    nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
    edges: Array.isArray(graph.edges) ? graph.edges : [],
  };
}

export function createGraphSnapshot(memoryStore = {}, options = {}) {
  const graph = graphFromStore(memoryStore);
  const createdAt = normalize(options.created_at || new Date().toISOString(), 80);
  const nodes = graph.nodes.map(compactNode).filter((node) => node.id);
  const edges = graph.edges.map(compactEdge).filter((edge) => edge.from && edge.to);
  return {
    schema_version: "memact.graph_snapshot.v1",
    snapshot_id: normalize(options.snapshot_id, 180) || `graph_snapshot:${createdAt}:${slug(options.label || memoryStore.generated_at || "memory")}`,
    label: normalize(options.label || "Memory graph snapshot", 180),
    created_at: createdAt,
    node_count: nodes.length,
    edge_count: edges.length,
    schema_count: nodes.filter((node) => node.type.includes("schema")).length,
    source_count: nodes.filter((node) => node.type.includes("source")).length,
    nodes,
    edges,
  };
}

export function attachGraphSnapshot(memoryStore = {}, options = {}) {
  const snapshot = createGraphSnapshot(memoryStore, options);
  const retention = Math.max(1, Number(options.retention ?? 24));
  const snapshots = [
    ...(Array.isArray(memoryStore.graph_snapshots) ? memoryStore.graph_snapshots : []),
    snapshot,
  ]
    .sort((left, right) => Date.parse(right.created_at || "") - Date.parse(left.created_at || ""))
    .slice(0, retention);
  return {
    ...memoryStore,
    graph_snapshots: snapshots,
  };
}

export function listGraphSnapshots(memoryStore = {}, options = {}) {
  const limit = Math.max(1, Number(options.limit ?? 12));
  return (Array.isArray(memoryStore.graph_snapshots) ? memoryStore.graph_snapshots : [])
    .slice()
    .sort((left, right) => Date.parse(right.created_at || "") - Date.parse(left.created_at || ""))
    .slice(0, limit);
}

export function diffGraphSnapshots(previous = {}, next = {}) {
  const previousNodes = new Set((previous.nodes || []).map((node) => node.id));
  const nextNodes = new Set((next.nodes || []).map((node) => node.id));
  const previousEdges = new Set((previous.edges || []).map((edge) => edge.id));
  const nextEdges = new Set((next.edges || []).map((edge) => edge.id));
  return {
    from_snapshot_id: previous.snapshot_id || "",
    to_snapshot_id: next.snapshot_id || "",
    added_nodes: [...nextNodes].filter((id) => !previousNodes.has(id)),
    removed_nodes: [...previousNodes].filter((id) => !nextNodes.has(id)),
    added_edges: [...nextEdges].filter((id) => !previousEdges.has(id)),
    removed_edges: [...previousEdges].filter((id) => !nextEdges.has(id)),
  };
}
