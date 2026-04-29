const MEMORY_SCHEMA_VERSION = "memact.memory.v0";
const DEFAULT_RETENTION_THRESHOLD = 0.34;
const DEFAULT_DECAY_PER_DAY = 0.006;
const MAX_SOURCES = 8;
const DEFAULT_RAG_TOP = 6;

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
    memory.core_interpretation,
    memory.action_tendency,
    ...(memory.emotional_signature || []),
    ...(memory.marker_categories || []),
    ...(memory.matched_markers || []),
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
  const packet = schema.virtual_schema_packet || schema.schema_packet || {};
  const evidenceRecords = Array.isArray(schema.evidence_records) ? schema.evidence_records : [];
  const evidenceStrength = evidenceRecords.length
    ? evidenceRecords.reduce((sum, record) => sum + Number(record.meaningful_score ?? 1), 0) / evidenceRecords.length
    : 0.5;
  const confidence = Number(schema.confidence ?? 0);
  const support = Number(schema.support ?? 0);
  const markerCategoryCount = Array.isArray(schema.marker_categories) ? schema.marker_categories.length : 0;
  const markerCoverage = Math.min(1, markerCategoryCount / 3);
  const strength = clamp((confidence * 0.48) + (Math.min(1, support / 8) * 0.22) + (evidenceStrength * 0.18) + (markerCoverage * 0.12));
  const evidencePacketIds = unique([
    ...(packet.evidence_packet_ids || []),
    ...evidenceRecords.map((record) => normalize(record.packet_id || `packet:${record.id}`)),
  ]);
  const sources = dedupeSources([
    ...(packet.sources || []),
    ...evidenceRecords.flatMap((record) => record.sources || []),
  ]);

  return {
    id: `memory:schema:${slug(id)}`,
    type: "cognitive_schema_memory",
    label: normalize(packet.label || schema.label || id, 160),
    summary: normalize(schema.summary || packet.summary, 360),
    virtual: true,
    cognitive_schema: true,
    strength,
    survival_score: strength,
    schema_id: id,
    schema_packet_id: normalize(packet.id || `schema_packet:${id}`),
    schema_state: normalize(schema.state),
    state_label: normalize(schema.state_label),
    core_interpretation: normalize(packet.core_interpretation || schema.core_interpretation, 280),
    action_tendency: normalize(packet.action_tendency || schema.action_tendency, 240),
    emotional_signature: unique(packet.emotional_signature || schema.emotional_signature),
    marker_categories: unique(packet.marker_categories || schema.marker_categories),
    matched_markers: unique(packet.matched_markers || schema.matched_markers),
    formation_basis: normalize(schema.formation_basis, 500),
    formation_metrics: schema.formation_metrics || packet.formation_metrics || {},
    support,
    confidence,
    themes: unique(packet.matched_themes || schema.matched_themes),
    evidence_packet_ids: evidencePacketIds,
    sources,
    provenance: {
      system: "schema",
      claim_type: "virtual_cognitive_schema_packet",
      schema_packet_id: normalize(packet.id || `schema_packet:${id}`),
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
      const schemaPacketId = memory.schema_packet_id || `schema_packet:${slug(memory.schema_id)}`;
      addNode({
        id: schemaPacketId,
        type: "virtual_cognitive_schema_packet",
        label: memory.label,
        strength: memory.strength,
      });
      edges.push({ from: memory.id, to: schemaPacketId, type: "stores_schema_packet", weight: memory.strength });

      for (const marker of memory.matched_markers || []) {
        const markerId = `memory:schema_marker:${slug(marker)}`;
        addNode({ id: markerId, type: "schema_marker_memory", label: marker });
        edges.push({ from: memory.id, to: markerId, type: "has_cognitive_marker", weight: memory.strength });
      }

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

function emptyMemoryStore(previous = {}) {
  const memories = Array.isArray(previous.memories) ? previous.memories : [];
  return refreshMemoryStore({
    schema_version: previous.schema_version || MEMORY_SCHEMA_VERSION,
    generated_at: previous.generated_at || nowIso(),
    source: previous.source || {},
    thresholds: previous.thresholds || {},
    memories,
    actions: Array.isArray(previous.actions) ? previous.actions : [],
  });
}

function refreshMemoryStore(memoryStore = {}) {
  const memories = Array.isArray(memoryStore.memories) ? memoryStore.memories : [];
  const graph = buildMemoryGraph(memories);
  return {
    schema_version: memoryStore.schema_version || MEMORY_SCHEMA_VERSION,
    generated_at: nowIso(),
    source: memoryStore.source || {},
    thresholds: memoryStore.thresholds || {},
    memories,
    activity_memories: memories.filter((memory) => memory.type === "activity_memory"),
    schema_packets: memories.filter(isSchemaMemory),
    cognitive_schema_memories: memories.filter(isSchemaMemory),
    graph,
    actions: Array.isArray(memoryStore.actions) ? memoryStore.actions : [],
    stats: {
      memoryCount: memories.length,
      activityMemoryCount: memories.filter((memory) => memory.type === "activity_memory").length,
      schemaMemoryCount: memories.filter(isSchemaMemory).length,
      sourceCount: graph.nodes.filter((node) => node.type === "source_memory").length,
    },
  };
}

function normalizeMemoryInput(input = {}) {
  const id = normalize(input.id) || `memory:manual:${slug(input.label || input.summary || Date.now())}`;
  const type = normalize(input.type) || "activity_memory";
  const strength = clamp(input.strength ?? input.survival_score ?? DEFAULT_RETENTION_THRESHOLD);
  return {
    id,
    type,
    label: normalize(input.label || id, 180),
    summary: normalize(input.summary, 500),
    virtual: Boolean(input.virtual),
    cognitive_schema: Boolean(input.cognitive_schema || type === "cognitive_schema_memory"),
    strength,
    survival_score: clamp(input.survival_score ?? strength),
    themes: unique(input.themes),
    sources: dedupeSources(input.sources),
    reasons: unique(input.reasons),
    first_seen_at: normalize(input.first_seen_at || input.created_at || nowIso()),
    last_seen_at: normalize(input.last_seen_at || input.updated_at || nowIso()),
    state: normalize(input.state) || "active",
    provenance: {
      system: normalize(input.provenance?.system || "memory"),
      claim_type: normalize(input.provenance?.claim_type || "manual_memory"),
      ...input.provenance,
    },
    ...input,
    id,
    type,
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

export function createMemory(memoryInput, memoryStore = {}) {
  const memory = normalizeMemoryInput(memoryInput);
  const existing = (memoryStore.memories || []).some((item) => item.id === memory.id);
  if (existing) {
    return {
      memoryStore: emptyMemoryStore(memoryStore),
      memory: readMemory(memory.id, memoryStore),
      action: makeAction("create_memory", memory.id, {}, false, "memory already exists"),
    };
  }
  const action = makeAction("create_memory", memory.id, { type: memory.type }, true, "memory created");
  const next = refreshMemoryStore({
    ...memoryStore,
    memories: [...(memoryStore.memories || []), memory],
    actions: [...(memoryStore.actions || []), action],
  });
  return { memoryStore: next, memory, action };
}

export function readMemory(memoryId, memoryStore = {}) {
  const id = normalize(memoryId);
  return (memoryStore.memories || []).find((memory) => memory.id === id) || null;
}

export function listMemories(memoryStore = {}, filters = {}) {
  const type = normalize(filters.type);
  const state = normalize(filters.state);
  const includeForgotten = Boolean(filters.includeForgotten);
  return (memoryStore.memories || [])
    .filter((memory) => !type || memory.type === type)
    .filter((memory) => !state || memory.state === state)
    .filter((memory) => includeForgotten || memory.state !== "forgotten")
    .sort((left, right) => Number(right.strength || 0) - Number(left.strength || 0) || left.label.localeCompare(right.label));
}

export function updateMemory(memoryId, patch = {}, memoryStore = {}) {
  const id = normalize(memoryId);
  let updated = null;
  const memories = (memoryStore.memories || []).map((memory) => {
    if (memory.id !== id) return memory;
    updated = normalizeMemoryInput({
      ...memory,
      ...patch,
      id: memory.id,
      type: patch.type || memory.type,
      sources: patch.sources ? dedupeSources([...(memory.sources || []), ...patch.sources]) : memory.sources,
      themes: patch.themes ? unique([...(memory.themes || []), ...patch.themes]) : memory.themes,
      reasons: patch.reasons ? unique([...(memory.reasons || []), ...patch.reasons]) : memory.reasons,
      last_seen_at: patch.last_seen_at || nowIso(),
    });
    return updated;
  });
  const action = makeAction("update_memory", id, { patch_keys: Object.keys(patch || {}) }, Boolean(updated), updated ? "memory updated" : "memory not found");
  const next = refreshMemoryStore({
    ...memoryStore,
    memories,
    actions: [...(memoryStore.actions || []), action],
  });
  return { memoryStore: next, memory: updated, action };
}

export function deleteMemory(memoryId, memoryStore = {}, options = {}) {
  if (options.hard) {
    const id = normalize(memoryId);
    const before = (memoryStore.memories || []).length;
    const memories = (memoryStore.memories || []).filter((memory) => memory.id !== id);
    const accepted = memories.length !== before;
    const action = makeAction("delete_memory", id, { hard: true }, accepted, accepted ? "memory deleted" : "memory not found");
    return {
      memoryStore: refreshMemoryStore({
        ...memoryStore,
        memories,
        actions: [...(memoryStore.actions || []), action],
      }),
      action,
    };
  }
  return forgetMemory(memoryId, memoryStore);
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

export function buildRagContext(query, memoryStore = {}, options = {}) {
  const top = Number(options.top ?? DEFAULT_RAG_TOP);
  const cognitiveSchemas = retrieveCognitiveSchemas(query, memoryStore, {
    top: Number(options.schemaTop ?? Math.min(4, top)),
    minScore: Number(options.schemaMinScore ?? 0.08),
  });
  const supportingMemories = retrieveMemories(query, memoryStore, {
    top,
    minScore: Number(options.minScore ?? 0.08),
  }).filter((memory) => !cognitiveSchemas.some((schema) => schema.id === memory.id));
  const sourceMap = new Map();
  [...cognitiveSchemas, ...supportingMemories].forEach((memory) => {
    (memory.sources || []).forEach((source) => {
      const key = source.url || `${source.domain}|${source.title}`;
      if (key && !sourceMap.has(key)) sourceMap.set(key, source);
    });
  });
  const contextItems = [...cognitiveSchemas, ...supportingMemories].slice(0, top).map((memory, index) => ({
    rank: index + 1,
    id: memory.id,
    type: memory.type,
    label: memory.label,
    summary: memory.summary,
    strength: Number(memory.strength || 0),
    retrieval_score: Number(memory.retrieval_score || 0),
    core_interpretation: memory.core_interpretation || "",
    action_tendency: memory.action_tendency || "",
    themes: memory.themes || [],
    evidence_packet_ids: memory.evidence_packet_ids || [],
    source_count: (memory.sources || []).length,
  }));

  return {
    contract: "memact.rag_context",
    version: "0.1.0",
    generated_at: nowIso(),
    query: normalize(query, 240),
    policy: {
      retrieval_first: true,
      prefer_cognitive_schema_memory: true,
      use_sources_as_evidence: true,
      no_diagnosis: true,
      no_causal_certainty: true,
      cloud_payload_minimized: true,
    },
    cognitive_schema_memories: cognitiveSchemas,
    supporting_memories: supportingMemories.slice(0, Math.max(0, top - cognitiveSchemas.length)),
    context_items: contextItems,
    sources: [...sourceMap.values()].slice(0, MAX_SOURCES),
    stats: {
      cognitive_schema_count: cognitiveSchemas.length,
      supporting_memory_count: supportingMemories.length,
      source_count: sourceMap.size,
    },
  };
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
    isSchemaMemory(memory) && memory.core_interpretation ? `frame: ${memory.core_interpretation}` : "",
    isSchemaMemory(memory) ? `${memory.support || 0} supporting packets` : "",
    memory.sources?.length ? `${memory.sources.length} source${memory.sources.length === 1 ? "" : "s"}` : "",
  ]);
  return reasons.length ? reasons.join(", ") : "it has retained evidence";
}

function isSchemaMemory(memory) {
  return memory?.type === "cognitive_schema_memory" || memory?.type === "schema_memory";
}
