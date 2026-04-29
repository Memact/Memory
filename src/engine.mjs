const MEMORY_SCHEMA_VERSION = "memact.memory.v0";
const DEFAULT_RETENTION_THRESHOLD = 0.34;
const DEFAULT_DECAY_PER_DAY = 0.006;
const MAX_SOURCES = 8;

function normalize(value, maxLength = 0) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (maxLength && text.length > maxLength) {
    return `${text.slice(0, maxLength - 3).trim()}...`;
  }
  return text;
}

function slug(value) {
  return normalize(value, 180)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "memory";
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => normalize(value)).filter(Boolean))];
}

function clamp(value, min = 0, max = 1) {
  const number = Number(value || 0);
  return Math.max(min, Math.min(max, Number(number.toFixed(4))));
}

function nowIso() {
  return new Date().toISOString();
}

function parseTime(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function daysSince(value, now = Date.now()) {
  const timestamp = parseTime(value);
  if (!timestamp) return 0;
  return Math.max(0, (now - timestamp) / 86400000);
}

function normalizeSource(source = {}) {
  const url = normalize(source.url, 500);
  const domain = normalize(source.domain, 120) || domainFromUrl(url);
  const title = normalize(source.title, 180) || domain || url || "Untitled source";
  return {
    url,
    domain,
    title,
    occurred_at: normalize(source.occurred_at, 80),
    application: normalize(source.application, 80),
  };
}

function domainFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function dedupeSources(sources = [], limit = MAX_SOURCES) {
  const seen = new Set();
  const output = [];
  for (const raw of Array.isArray(sources) ? sources : []) {
    const source = normalizeSource(raw);
    const key = source.url || `${source.domain}|${source.title}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(source);
    if (output.length >= limit) break;
  }
  return output;
}

function tokenSet(value) {
  return new Set(
    normalize(value)
      .toLowerCase()
      .replace(/[^a-z0-9@#./+-]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  );
}

function overlapScore(query, memory) {
  const queryTokens = tokenSet(query);
  if (!queryTokens.size) return 0;
  const memoryTokens = tokenSet([
    memory.label,
    memory.summary,
    ...(memory.themes || []),
    ...(memory.sources || []).map((source) => `${source.title} ${source.domain}`),
  ].join(" "));
  let overlap = 0;
  for (const token of queryTokens) {
    if (memoryTokens.has(token)) overlap += 1;
  }
  return clamp(overlap / queryTokens.size);
}

function activityMemoryFromRecord(record, options = {}) {
  const threshold = Number(options.retentionThreshold ?? DEFAULT_RETENTION_THRESHOLD);
  const sourcePacketId = normalize(record.packet_id || record.packet?.id || `packet:${record.id}`);
  const sources = dedupeSources(record.sources || record.packet?.sources);
  const themes = unique(record.canonical_themes || record.packet?.canonical_themes);
  const meaningfulScore = clamp(record.meaningful_score ?? record.packet?.meaningful_score ?? 0);
  const sourceScore = sources.length ? 0.08 : 0;
  const themeScore = themes.length ? 0.08 : 0;
  const survivalScore = clamp((meaningfulScore * 0.82) + sourceScore + themeScore);

  if (record.meaningful === false || survivalScore < threshold) {
    return null;
  }

  return {
    id: `memory:activity:${slug(sourcePacketId)}`,
    type: "activity_memory",
    label: normalize(record.source_label || record.packet?.label || record.evidence?.title || "Activity memory", 180),
    summary: normalize(record.evidence?.text_excerpt || record.packet?.evidence?.text_excerpt, 360),
    strength: survivalScore,
    survival_score: survivalScore,
    meaningful_score: meaningfulScore,
    source_packet_id: sourcePacketId,
    source_record_id: normalize(record.id || record.packet?.source_record_id),
    themes,
    sources,
    reasons: unique(record.meaning_reasons || record.packet?.reasons),
    first_seen_at: normalize(record.started_at || record.packet?.started_at || sources[0]?.occurred_at),
    last_seen_at: normalize(record.ended_at || record.packet?.ended_at || record.started_at || sources[0]?.occurred_at),
    provenance: {
      system: "inference",
      claim_type: "meaning_packet",
      packet_id: sourcePacketId,
    },
    state: "active",
  };
}

function schemaMemoryFromSchema(schema) {
  const id = normalize(schema?.id);
  if (!id) return null;
  const evidenceRecords = Array.isArray(schema.evidence_records) ? schema.evidence_records : [];
  const evidenceStrength = evidenceRecords.length
    ? evidenceRecords.reduce((sum, record) => sum + Number(record.meaningful_score ?? 1), 0) / evidenceRecords.length
    : 0.5;
  const confidence = Number(schema.confidence ?? 0);
  const support = Number(schema.support ?? 0);
  const strength = clamp((confidence * 0.54) + (Math.min(1, support / 8) * 0.26) + (evidenceStrength * 0.2));

  return {
    id: `memory:schema:${slug(id)}`,
    type: "cognitive_schema_memory",
    label: normalize(schema.label || id, 160),
    summary: normalize(schema.summary, 360),
    virtual: true,
    cognitive_schema: true,
    strength,
    survival_score: strength,
    schema_id: id,
    schema_state: normalize(schema.state),
    state_label: normalize(schema.state_label),
    support,
    confidence,
    themes: unique(schema.matched_themes),
    evidence_packet_ids: evidenceRecords
      .map((record) => normalize(record.packet_id || `packet:${record.id}`))
      .filter(Boolean),
    sources: dedupeSources(evidenceRecords.flatMap((record) => record.sources || [])),
    provenance: {
      system: "schema",
      claim_type: "virtual_cognitive_schema_packet",
      schema_id: id,
      guardrail: normalize(schema.language_guardrail),
    },
    state: "active",
  };
}

function decayMemory(memory, options = {}) {
  const decayPerDay = Number(options.decayPerDay ?? DEFAULT_DECAY_PER_DAY);
  const ageDays = daysSince(memory.last_seen_at || memory.first_seen_at);
  const decay = Math.min(0.35, ageDays * decayPerDay);
  const decayedStrength = clamp(Number(memory.strength || 0) - decay);
  return {
    ...memory,
    strength: decayedStrength,
    decay: {
      age_days: Number(ageDays.toFixed(2)),
      decay_amount: Number(decay.toFixed(4)),
      decay_per_day: decayPerDay,
    },
  };
}

function mergeDuplicateMemories(memories) {
  const byKey = new Map();
  for (const memory of memories) {
    const key = isSchemaMemory(memory)
      ? `${memory.type}|${memory.schema_id}`
      : `${memory.type}|${memory.source_packet_id || memory.label}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, memory);
      continue;
    }
    byKey.set(key, {
      ...existing,
      strength: clamp(Math.max(existing.strength, memory.strength) + 0.04),
      survival_score: clamp(Math.max(existing.survival_score, memory.survival_score) + 0.04),
      themes: unique([...(existing.themes || []), ...(memory.themes || [])]),
      sources: dedupeSources([...(existing.sources || []), ...(memory.sources || [])]),
      reasons: unique([...(existing.reasons || []), ...(memory.reasons || [])]),
      last_seen_at: [existing.last_seen_at, memory.last_seen_at].sort().filter(Boolean).at(-1) || existing.last_seen_at,
    });
  }
  return [...byKey.values()];
}

function buildMemoryGraph(memories) {
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const addNode = (node) => {
    if (!node?.id || seen.has(node.id)) return;
    seen.add(node.id);
    nodes.push(node);
  };

  for (const memory of memories) {
    addNode({
      id: memory.id,
      type: memory.type,
      label: memory.label,
      strength: memory.strength,
      state: memory.state,
    });

    for (const theme of memory.themes || []) {
      const themeId = `memory:theme:${slug(theme)}`;
      addNode({ id: themeId, type: "theme_memory", label: theme });
      edges.push({ from: memory.id, to: themeId, type: "has_theme", weight: memory.strength });
    }

    for (const source of memory.sources || []) {
      const sourceKey = source.url || source.domain || source.title;
      if (!sourceKey) continue;
      const sourceId = `memory:source:${slug(sourceKey)}`;
      addNode({
        id: sourceId,
        type: "source_memory",
        label: source.title || source.domain || source.url,
        url: source.url,
        domain: source.domain,
      });
      edges.push({ from: memory.id, to: sourceId, type: "supported_by_source", weight: 1 });
    }

    if (isSchemaMemory(memory)) {
      for (const packetId of memory.evidence_packet_ids || []) {
        const activityId = `memory:activity:${slug(packetId)}`;
        edges.push({ from: memory.id, to: activityId, type: "supported_by_packet", weight: memory.strength });
      }
    }
  }

  return { nodes, edges };
}

function makeAction(type, memoryId, payload = {}, accepted = true, reason = "") {
  return {
    id: `action:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    type,
    memory_id: memoryId,
    accepted,
    reason: normalize(reason),
    payload,
    occurred_at: nowIso(),
  };
}

export function buildMemoryStore({ inference, schema, previousMemory = null, options = {} } = {}) {
  const activityMemories = (Array.isArray(inference?.records) ? inference.records : [])
    .map((record) => activityMemoryFromRecord(record, options))
    .filter(Boolean);
  const schemaPackets = (Array.isArray(schema?.schemas) ? schema.schemas : [])
    .map(schemaMemoryFromSchema)
    .filter(Boolean);
  const previousMemories = Array.isArray(previousMemory?.memories) ? previousMemory.memories : [];
  const merged = mergeDuplicateMemories([...previousMemories, ...activityMemories, ...schemaPackets])
    .map((memory) => decayMemory(memory, options))
    .sort((left, right) => right.strength - left.strength || left.label.localeCompare(right.label));
  const graph = buildMemoryGraph(merged);

  return {
    schema_version: MEMORY_SCHEMA_VERSION,
    generated_at: nowIso(),
    source: {
      inference_schema_version: inference?.schema_version || null,
      schema_schema_version: schema?.schema_version || null,
      previous_memory_version: previousMemory?.schema_version || null,
    },
    thresholds: {
      retention_score: Number(options.retentionThreshold ?? DEFAULT_RETENTION_THRESHOLD),
      decay_per_day: Number(options.decayPerDay ?? DEFAULT_DECAY_PER_DAY),
    },
    memories: merged,
    activity_memories: merged.filter((memory) => memory.type === "activity_memory"),
    schema_packets: merged.filter(isSchemaMemory),
    cognitive_schema_memories: merged.filter(isSchemaMemory),
    graph,
    actions: Array.isArray(previousMemory?.actions) ? previousMemory.actions : [],
    stats: {
      memoryCount: merged.length,
      activityMemoryCount: merged.filter((memory) => memory.type === "activity_memory").length,
      schemaMemoryCount: merged.filter(isSchemaMemory).length,
      sourceCount: graph.nodes.filter((node) => node.type === "source_memory").length,
    },
  };
}

export function retrieveMemories(query, memoryStore, options = {}) {
  const top = Number(options.top ?? 8);
  const minScore = Number(options.minScore ?? 0.12);
  const memories = Array.isArray(memoryStore?.memories) ? memoryStore.memories : [];
  return memories
    .map((memory) => {
      const lexical = overlapScore(query, memory);
      const score = clamp((lexical * 0.56) + (Number(memory.strength || 0) * 0.34) + (isSchemaMemory(memory) ? 0.1 : 0));
      return {
        ...memory,
        retrieval_score: score,
        retrieval_reason: lexical
          ? "query overlap with retained memory"
          : "high-strength retained memory",
      };
    })
    .filter((memory) => memory.retrieval_score >= minScore)
    .sort((left, right) => right.retrieval_score - left.retrieval_score || right.strength - left.strength)
    .slice(0, top);
}

export function retrieveCognitiveSchemas(query, memoryStore, options = {}) {
  return retrieveMemories(query, {
    ...memoryStore,
    memories: (memoryStore?.memories || []).filter(isSchemaMemory),
  }, {
    top: Number(options.top ?? 4),
    minScore: Number(options.minScore ?? 0.12),
  });
}

export function rememberPacket(packet, memoryStore = {}, options = {}) {
  const memory = activityMemoryFromRecord(packet, options);
  if (!memory) {
    return {
      memoryStore,
      action: makeAction("remember_packet", "", { packet_id: packet?.packet_id || packet?.id }, false, "packet did not pass retention threshold"),
    };
  }
  const next = buildMemoryStore({
    inference: { records: [packet], schema_version: "memact.inference.v0" },
    schema: { schemas: [], schema_version: "memact.schema.v0" },
    previousMemory: memoryStore,
    options,
  });
  const action = makeAction("remember_packet", memory.id, { packet_id: memory.source_packet_id }, true, "packet retained");
  next.actions = [...(next.actions || []), action];
  return { memoryStore: next, action };
}

export function rememberSchema(schemaPacket, memoryStore = {}) {
  const memory = schemaMemoryFromSchema(schemaPacket);
  if (!memory) {
    return {
      memoryStore,
      action: makeAction("remember_schema", "", { schema_id: schemaPacket?.id }, false, "schema packet missing id"),
    };
  }
  const next = buildMemoryStore({
    inference: { records: [], schema_version: "memact.inference.v0" },
    schema: { schemas: [schemaPacket], schema_version: "memact.schema.v0" },
    previousMemory: memoryStore,
  });
  const action = makeAction("remember_schema", memory.id, { schema_id: memory.schema_id }, true, "schema retained");
  next.actions = [...(next.actions || []), action];
  return { memoryStore: next, action };
}

export function reinforceMemory(memoryId, evidence = {}, memoryStore = {}) {
  const action = makeAction("reinforce_memory", memoryId, evidence, true, "memory reinforced by evidence");
  return applyMemoryAction(memoryStore, action, (memory) => ({
    ...memory,
    strength: clamp(Number(memory.strength || 0) + 0.08),
    survival_score: clamp(Number(memory.survival_score || 0) + 0.08),
    sources: dedupeSources([...(memory.sources || []), ...(evidence.sources || [])]),
  }));
}

export function weakenMemory(memoryId, reason = "", memoryStore = {}) {
  const action = makeAction("weaken_memory", memoryId, { reason: normalize(reason) }, true, "memory weakened");
  return applyMemoryAction(memoryStore, action, (memory) => ({
    ...memory,
    strength: clamp(Number(memory.strength || 0) - 0.12),
    state: Number(memory.strength || 0) <= 0.16 ? "weak" : memory.state,
  }));
}

export function forgetMemory(memoryId, memoryStore = {}) {
  const action = makeAction("forget_memory", memoryId, {}, true, "memory forgotten");
  return applyMemoryAction(memoryStore, action, (memory) => ({
    ...memory,
    strength: 0,
    state: "forgotten",
  }));
}

export function linkMemories(fromId, toId, memoryStore = {}, relation = "related") {
  const action = makeAction("link_memories", fromId, { to: toId, relation }, true, "memories linked");
  const graph = memoryStore?.graph || { nodes: [], edges: [] };
  return {
    ...memoryStore,
    graph: {
      nodes: graph.nodes || [],
      edges: [
        ...(graph.edges || []),
        {
          from: fromId,
          to: toId,
          type: normalize(relation, 60) || "related",
          weight: 1,
        },
      ],
    },
    actions: [...(memoryStore.actions || []), action],
  };
}

export function explainMemory(memoryId, memoryStore = {}) {
  const memory = (memoryStore.memories || []).find((item) => item.id === memoryId);
  if (!memory) {
    return null;
  }
  return {
    id: memory.id,
    type: memory.type,
    label: memory.label,
    summary: memory.summary,
    strength: memory.strength,
    themes: memory.themes || [],
    sources: memory.sources || [],
    provenance: memory.provenance,
    explanation: `${memory.label} survived because ${formatReasons(memory)}.`,
  };
}

export function getMemoryGraph(memoryStore = {}) {
  return memoryStore.graph || buildMemoryGraph(memoryStore.memories || []);
}

export function formatMemoryReport(memoryStore = {}) {
  const lines = [
    "Memact Memory Report",
    `Memories: ${memoryStore.stats?.memoryCount || 0}`,
    `Activity memories: ${memoryStore.stats?.activityMemoryCount || 0}`,
    `Cognitive schema memories: ${memoryStore.stats?.schemaMemoryCount || 0}`,
    "",
    "Strongest Memories",
  ];

  const memories = Array.isArray(memoryStore.memories) ? memoryStore.memories : [];
  if (!memories.length) {
    lines.push("No memories met the survival threshold.");
    return lines.join("\n");
  }

  memories.slice(0, 10).forEach((memory, index) => {
    lines.push(`${index + 1}. ${memory.label}`);
    lines.push(`   type=${memory.type} strength=${Number(memory.strength || 0).toFixed(3)} themes=${(memory.themes || []).join(", ") || "none"}`);
    lines.push(`   why=${formatReasons(memory)}`);
  });

  return lines.join("\n");
}

function applyMemoryAction(memoryStore, action, mutate) {
  let matched = false;
  const memories = (memoryStore.memories || []).map((memory) => {
    if (memory.id !== action.memory_id) return memory;
    matched = true;
    return mutate(memory);
  });
  const finalAction = matched ? action : { ...action, accepted: false, reason: "memory not found" };
  const next = {
    ...memoryStore,
    memories,
    activity_memories: memories.filter((memory) => memory.type === "activity_memory"),
    schema_packets: memories.filter(isSchemaMemory),
    cognitive_schema_memories: memories.filter(isSchemaMemory),
    graph: buildMemoryGraph(memories),
    actions: [...(memoryStore.actions || []), finalAction],
    stats: {
      ...(memoryStore.stats || {}),
      memoryCount: memories.length,
      activityMemoryCount: memories.filter((memory) => memory.type === "activity_memory").length,
      schemaMemoryCount: memories.filter(isSchemaMemory).length,
    },
  };
  return { memoryStore: next, action: finalAction };
}

function formatReasons(memory) {
  const reasons = unique([
    ...(memory.reasons || []),
    isSchemaMemory(memory) ? `${memory.support || 0} supporting packets` : "",
    memory.sources?.length ? `${memory.sources.length} source${memory.sources.length === 1 ? "" : "s"}` : "",
  ]);
  return reasons.length ? reasons.join(", ") : "it has retained evidence";
}

function isSchemaMemory(memory) {
  return memory?.type === "cognitive_schema_memory" || memory?.type === "schema_memory";
}
