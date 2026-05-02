export const CORE_SCHEMA_VERSION = "memact.core.v1";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T/;

function normalize(value, maxLength = 0) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return maxLength && text.length > maxLength
    ? `${text.slice(0, maxLength - 3).trim()}...`
    : text;
}

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function slug(value, fallback = "record") {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function stableId(prefix, parts) {
  const body = slug(asArray(parts).filter(Boolean).join("_"), `${Date.now()}`);
  return `${prefix}:${body}`;
}

function isIsoish(value) {
  return typeof value === "string" && ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function score(value, fallback = 0) {
  return Number(clamp01(value, fallback).toFixed(4));
}

function coreError(path, message) {
  return { path, message };
}

function checkString(errors, record, key, { required = false, maxLength = 0 } = {}) {
  const value = normalize(record[key], maxLength);
  if (required && !value) errors.push(coreError(key, "required string"));
  return value;
}

function checkDate(errors, record, key, { required = false, fallback = "" } = {}) {
  const value = normalize(record[key]) || fallback;
  if (required && !value) {
    errors.push(coreError(key, "required timestamp"));
    return value;
  }
  if (value && !isIsoish(value)) errors.push(coreError(key, "must be ISO timestamp"));
  return value;
}

function validationResult(kind, value, errors = [], warnings = []) {
  return {
    ok: errors.length === 0,
    kind,
    value: errors.length === 0 ? value : null,
    errors,
    warnings,
  };
}

export function normalizeEvidenceLink(input = {}) {
  const record = asObject(input);
  const evidenceId = normalize(record.evidence_id || record.id, 120) ||
    stableId("evidence", [record.packet_id, record.unit_id, record.source_url, record.snippet]);
  return {
    schema_version: CORE_SCHEMA_VERSION,
    evidence_id: evidenceId,
    packet_id: normalize(record.packet_id, 120),
    unit_id: normalize(record.unit_id, 120),
    source_url: normalize(record.source_url || record.url, 600),
    timestamp: normalize(record.timestamp || record.occurred_at || record.captured_at, 80),
    snippet: normalize(record.snippet || record.text || record.evidence, 1000),
    claim_supported: normalize(record.claim_supported || record.claim_id || record.claim, 240),
    score: score(record.score ?? record.confidence, 0.5),
    evidence_type: normalize(record.evidence_type || record.type || "captured_activity", 80),
    metadata: asObject(record.metadata),
  };
}

export function validateEvidenceLink(input = {}) {
  const value = normalizeEvidenceLink(input);
  const errors = [];
  checkString(errors, value, "evidence_id", { required: true });
  if (!value.packet_id && !value.unit_id && !value.source_url && !value.snippet) {
    errors.push(coreError("evidence", "requires packet, unit, source URL, or snippet"));
  }
  if (value.timestamp && !isIsoish(value.timestamp)) {
    errors.push(coreError("timestamp", "must be ISO timestamp"));
  }
  if (!value.claim_supported) {
    errors.push(coreError("claim_supported", "required claim link"));
  }
  return validationResult("EvidenceLink", value, errors);
}

export function normalizeActivityEvent(input = {}) {
  const record = asObject(input);
  const occurredAt = normalize(record.occurred_at || record.timestamp || record.captured_at) || nowIso();
  const title = normalize(record.title || record.window_title || record.label, 240);
  const url = normalize(record.url, 600);
  const source = normalize(record.source || "capture", 80);
  return {
    schema_version: CORE_SCHEMA_VERSION,
    id: normalize(record.id, 120) || stableId("activity", [source, occurredAt, url || title]),
    source,
    occurred_at: occurredAt,
    url,
    domain: normalize(record.domain, 160),
    title,
    application: normalize(record.application || "Browser", 120),
    activity_type: normalize(record.activity_type || record.interaction_type || "activity", 80),
    content_text: normalize(record.content_text || record.full_text || record.searchable_text, 4000),
    semantic_topics: asArray(record.semantic_topics || record.context_topics || record.topics).map((item) => normalize(item, 80)).filter(Boolean),
    emotional_tone: normalize(record.emotional_tone || record.emotion, 80),
    interaction_strength: score(record.interaction_strength ?? record.selective_memory?.rememberScore, 0.5),
    source_type: normalize(record.source_type || record.page_type || "webpage", 80),
    evidence_ids: asArray(record.evidence_ids).map((id) => normalize(id, 120)).filter(Boolean),
    metadata: asObject(record.metadata),
  };
}

export function validateActivityEvent(input = {}) {
  const value = normalizeActivityEvent(input);
  const errors = [];
  checkString(errors, value, "id", { required: true });
  checkDate(errors, value, "occurred_at", { required: true });
  if (!value.title && !value.url && !value.content_text) {
    errors.push(coreError("activity", "requires title, url, or content_text"));
  }
  if (value.source_type === "password" || value.source_type === "login_private") {
    errors.push(coreError("source_type", "sensitive activity must be filtered before ingestion"));
  }
  return validationResult("ActivityEvent", value, errors);
}

export function normalizeContentUnit(input = {}) {
  const record = asObject(input);
  const text = normalize(record.text || record.caption || record.alt, 3000);
  return {
    schema_version: CORE_SCHEMA_VERSION,
    unit_id: normalize(record.unit_id || record.id, 120) || stableId("unit", [record.packet_id, text.slice(0, 80)]),
    packet_id: normalize(record.packet_id, 120),
    media_type: normalize(record.media_type || "webpage", 80),
    unit_type: normalize(record.unit_type || record.type || "text", 80),
    text,
    location: normalize(record.location || record.section, 160),
    timestamp: normalize(record.timestamp || record.captured_at || record.occurred_at, 80),
    confidence: score(record.confidence, 0.72),
    metadata: asObject(record.metadata),
  };
}

export function validateContentUnit(input = {}) {
  const value = normalizeContentUnit(input);
  const errors = [];
  checkString(errors, value, "unit_id", { required: true });
  checkString(errors, value, "text", { required: true });
  if (value.timestamp && !isIsoish(value.timestamp)) {
    errors.push(coreError("timestamp", "must be ISO timestamp"));
  }
  return validationResult("ContentUnit", value, errors);
}

export function normalizeGraphPacket(input = {}) {
  const record = asObject(input);
  const contentUnits = asArray(record.content_units).map(normalizeContentUnit);
  return {
    schema_version: CORE_SCHEMA_VERSION,
    packet_id: normalize(record.packet_id || record.id, 120) ||
      stableId("packet", [record.url, record.title, record.captured_at]),
    packet_type: normalize(record.packet_type || "multimedia_graph_capture", 100),
    source: normalize(record.source || "capture", 80),
    captured_at: normalize(record.captured_at || record.occurred_at, 80) || nowIso(),
    url: normalize(record.url, 600),
    title: normalize(record.title, 240),
    media_type: normalize(record.media_type || "webpage", 80),
    content_units: contentUnits,
    nodes: asArray(record.nodes).map(normalizeMemoryNode),
    edges: asArray(record.edges).map(normalizeMemoryEdge),
    evidence_ids: asArray(record.evidence_ids).map((id) => normalize(id, 120)).filter(Boolean),
    metadata: asObject(record.metadata),
  };
}

export function validateGraphPacket(input = {}) {
  const value = normalizeGraphPacket(input);
  const errors = [];
  checkString(errors, value, "packet_id", { required: true });
  checkDate(errors, value, "captured_at", { required: true });
  if (!value.content_units.length) {
    errors.push(coreError("content_units", "requires at least one content unit"));
  }
  value.content_units.forEach((unit, index) => {
    const result = validateContentUnit(unit);
    if (!result.ok) {
      result.errors.forEach((error) => errors.push(coreError(`content_units.${index}.${error.path}`, error.message)));
    }
  });
  return validationResult("GraphPacket", value, errors);
}

export function normalizeMemoryNode(input = {}) {
  const record = asObject(input);
  const label = normalize(record.label || record.title || record.summary, 240);
  return {
    schema_version: CORE_SCHEMA_VERSION,
    id: normalize(record.id, 160) || stableId("memory", [record.type, label]),
    type: normalize(record.type || "memory_node", 80),
    label,
    summary: normalize(record.summary, 1000),
    strength: score(record.strength ?? record.weight, 0.5),
    created_at: normalize(record.created_at, 80) || nowIso(),
    updated_at: normalize(record.updated_at || record.last_seen_at, 80) || nowIso(),
    evidence_ids: asArray(record.evidence_ids || record.evidence_packet_ids).map((id) => normalize(id, 120)).filter(Boolean),
    source_ids: asArray(record.source_ids).map((id) => normalize(id, 120)).filter(Boolean),
    metadata: asObject(record.metadata),
  };
}

export function validateMemoryNode(input = {}) {
  const value = normalizeMemoryNode(input);
  const errors = [];
  checkString(errors, value, "id", { required: true });
  checkString(errors, value, "type", { required: true });
  checkString(errors, value, "label", { required: true });
  checkDate(errors, value, "created_at", { required: true });
  checkDate(errors, value, "updated_at", { required: true });
  return validationResult("MemoryNode", value, errors);
}

export function normalizeMemoryEdge(input = {}) {
  const record = asObject(input);
  const from = normalize(record.from || record.source, 160);
  const to = normalize(record.to || record.target, 160);
  const type = normalize(record.type || record.relation || "related", 100);
  return {
    schema_version: CORE_SCHEMA_VERSION,
    id: normalize(record.id, 200) || stableId("edge", [from, type, to]),
    from,
    to,
    type,
    weight: score(record.weight ?? record.strength, 0.5),
    confidence: score(record.confidence ?? record.weight, 0.5),
    evidence_ids: asArray(record.evidence_ids || record.evidence_packet_ids).map((id) => normalize(id, 120)).filter(Boolean),
    created_at: normalize(record.created_at, 80) || nowIso(),
    metadata: asObject(record.metadata),
  };
}

export function validateMemoryEdge(input = {}) {
  const value = normalizeMemoryEdge(input);
  const errors = [];
  checkString(errors, value, "id", { required: true });
  checkString(errors, value, "from", { required: true });
  checkString(errors, value, "to", { required: true });
  checkString(errors, value, "type", { required: true });
  if (value.from === value.to) errors.push(coreError("to", "edge cannot point to itself"));
  return validationResult("MemoryEdge", value, errors);
}

export function normalizeInfluenceClaim(input = {}) {
  const record = asObject(input);
  return {
    schema_version: CORE_SCHEMA_VERSION,
    claim_id: normalize(record.claim_id || record.id, 160) ||
      stableId("claim", [record.claim_type || record.type, record.text || record.label]),
    claim_type: normalize(record.claim_type || record.type || "possible_influence", 100),
    text: normalize(record.text || record.summary || record.label, 1000),
    uncertainty: normalize(record.uncertainty || "possible", 80),
    supporting_evidence_ids: asArray(record.supporting_evidence_ids || record.evidence_ids).map((id) => normalize(id, 120)).filter(Boolean),
    contradicted_by_evidence_ids: asArray(record.contradicted_by_evidence_ids).map((id) => normalize(id, 120)).filter(Boolean),
    confidence: score(record.confidence, 0.5),
    metadata: asObject(record.metadata),
  };
}

export function validateInfluenceClaim(input = {}) {
  const value = normalizeInfluenceClaim(input);
  const errors = [];
  checkString(errors, value, "claim_id", { required: true });
  checkString(errors, value, "claim_type", { required: true });
  checkString(errors, value, "text", { required: true });
  if (!value.supporting_evidence_ids.length && value.claim_type !== "unknown_origin") {
    errors.push(coreError("supporting_evidence_ids", "required for non-unknown claims"));
  }
  return validationResult("InfluenceClaim", value, errors);
}

export function normalizeThoughtTrace(input = {}) {
  const record = asObject(input);
  const thought = normalize(record.thought || record.query || record.text, 600);
  return {
    schema_version: CORE_SCHEMA_VERSION,
    trace_id: normalize(record.trace_id || record.id, 160) || stableId("thought", [thought, record.created_at]),
    thought,
    created_at: normalize(record.created_at, 80) || nowIso(),
    claim_ids: asArray(record.claim_ids).map((id) => normalize(id, 120)).filter(Boolean),
    evidence_ids: asArray(record.evidence_ids).map((id) => normalize(id, 120)).filter(Boolean),
    influence_path_ids: asArray(record.influence_path_ids).map((id) => normalize(id, 120)).filter(Boolean),
    status: normalize(record.status || "open", 80),
    metadata: asObject(record.metadata),
  };
}

export function validateThoughtTrace(input = {}) {
  const value = normalizeThoughtTrace(input);
  const errors = [];
  checkString(errors, value, "trace_id", { required: true });
  checkString(errors, value, "thought", { required: true });
  checkDate(errors, value, "created_at", { required: true });
  return validationResult("ThoughtTrace", value, errors);
}

export const CORE_VALIDATORS = Object.freeze({
  ActivityEvent: validateActivityEvent,
  ContentUnit: validateContentUnit,
  GraphPacket: validateGraphPacket,
  MemoryNode: validateMemoryNode,
  MemoryEdge: validateMemoryEdge,
  EvidenceLink: validateEvidenceLink,
  InfluenceClaim: validateInfluenceClaim,
  ThoughtTrace: validateThoughtTrace,
});

export function validateCoreRecord(kind, record) {
  const validator = CORE_VALIDATORS[kind];
  if (!validator) {
    return validationResult(kind, null, [coreError("kind", `unknown core schema ${kind}`)]);
  }
  return validator(record);
}

export function safeIngestCoreRecord(kind, record, options = {}) {
  const result = validateCoreRecord(kind, record);
  if (result.ok) {
    return {
      accepted: true,
      kind,
      record: result.value,
      quarantine: null,
    };
  }
  const quarantine = {
    schema_version: CORE_SCHEMA_VERSION,
    kind,
    rejected_at: nowIso(),
    reason: "schema_validation_failed",
    errors: result.errors,
    raw_record: options.keepRaw === false ? null : record,
  };
  return {
    accepted: false,
    kind,
    record: null,
    quarantine,
  };
}
