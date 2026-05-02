import { categorizeInfluenceLink } from "./influence-categories.mjs";
import { enrichSourceMetadata } from "./source-metadata.mjs";

function normalize(value, maxLength = 0) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return maxLength && text.length > maxLength
    ? `${text.slice(0, maxLength - 3).trim()}...`
    : text;
}

function slug(value, fallback = "path") {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function unique(values = []) {
  return [...new Set(values.map((value) => normalize(value)).filter(Boolean))];
}

function makeStep(input = {}) {
  const type = normalize(input.type || "step", 80);
  const label = normalize(input.label || input.id || type, 240);
  return {
    id: normalize(input.id, 160) || `${type}:${slug(label)}`,
    type,
    label,
    weight: Number(clamp01(input.weight ?? input.score, 0.5).toFixed(4)),
    evidence_ids: unique(input.evidence_ids || input.evidence_packet_ids),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

export function createInfluencePath({
  path_id = "",
  thought = "",
  steps = [],
  evidence_ids = [],
  confidence = 0,
  uncertainty = "possible",
  category = "unclassified",
  summary = "",
} = {}) {
  const normalizedSteps = (Array.isArray(steps) ? steps : []).map(makeStep).filter((step) => step.id && step.label);
  const allEvidenceIds = unique([
    ...evidence_ids,
    ...normalizedSteps.flatMap((step) => step.evidence_ids),
  ]);
  const id = normalize(path_id, 180) || `influence_path:${slug([thought, ...normalizedSteps.map((step) => step.label)].join("_"))}`;
  const resolvedCategory = category && category !== "unclassified"
    ? normalize(category, 100)
    : categorizeInfluenceLink({ thought, steps: normalizedSteps, summary });
  return {
    schema_version: "memact.influence_path.v1",
    path_id: id,
    thought: normalize(thought, 600),
    category: resolvedCategory,
    influence_category: resolvedCategory,
    uncertainty: normalize(uncertainty, 80) || "possible",
    confidence: Number(clamp01(confidence, averageWeight(normalizedSteps)).toFixed(4)),
    evidence_ids: allEvidenceIds,
    steps: normalizedSteps,
    summary: normalize(summary, 1000),
  };
}

function averageWeight(steps) {
  if (!steps.length) return 0;
  return steps.reduce((sum, step) => sum + Number(step.weight || 0), 0) / steps.length;
}

export function validateInfluencePath(path = {}) {
  const errors = [];
  if (!normalize(path.path_id)) errors.push({ path: "path_id", message: "required" });
  if (!normalize(path.thought)) errors.push({ path: "thought", message: "required" });
  if (!Array.isArray(path.steps) || path.steps.length < 2) {
    errors.push({ path: "steps", message: "requires at least two ordered steps" });
  }
  if (!Array.isArray(path.evidence_ids) || !path.evidence_ids.length) {
    errors.push({ path: "evidence_ids", message: "requires traceable evidence" });
  }
  return {
    ok: errors.length === 0,
    errors,
    value: errors.length ? null : path,
  };
}

export function buildInfluencePathFromMemory({
  thought = "",
  source = {},
  contentUnit = {},
  concept = "",
  schema = {},
  thoughtScore = 0.5,
} = {}) {
  const enrichedSource = enrichSourceMetadata(source);
  const evidenceIds = unique([
    enrichedSource.evidence_id,
    contentUnit.evidence_id,
    ...(schema.evidence_packet_ids || []),
    ...(schema.evidence_ids || []),
  ]);
  return createInfluencePath({
    thought,
    category: "possible_memory_influence",
    confidence: thoughtScore,
    evidence_ids: evidenceIds,
    steps: [
      {
        type: "digital_exposure",
        label: enrichedSource.title || enrichedSource.domain || enrichedSource.url || "captured source",
        weight: enrichedSource.score ?? enrichedSource.source_strength_score ?? 0.5,
        evidence_ids: enrichedSource.evidence_id ? [enrichedSource.evidence_id] : [],
        metadata: {
          url: enrichedSource.url || "",
          source_type: enrichedSource.source_type || "",
          source_strength_score: enrichedSource.source_strength_score,
          timestamp: enrichedSource.timestamp || enrichedSource.occurred_at || "",
        },
      },
      {
        type: "content_unit",
        label: contentUnit.text || contentUnit.label || contentUnit.unit_id || "captured content",
        weight: contentUnit.score ?? contentUnit.confidence ?? 0.5,
        evidence_ids: contentUnit.evidence_id ? [contentUnit.evidence_id] : [],
        metadata: {
          unit_id: contentUnit.unit_id || "",
          packet_id: contentUnit.packet_id || "",
        },
      },
      {
        type: "concept",
        label: concept || schema.label || "related concept",
        weight: schema.retrieval_score ?? schema.strength ?? 0.5,
        evidence_ids: schema.evidence_packet_ids || schema.evidence_ids || [],
      },
      {
        type: "cognitive_schema",
        label: schema.label || schema.id || "possible schema",
        weight: schema.strength ?? schema.confidence ?? 0.5,
        evidence_ids: schema.evidence_packet_ids || schema.evidence_ids || [],
        metadata: {
          schema_id: schema.id || "",
          state: schema.state || schema.schema_state || "",
        },
      },
      {
        type: "thought_match",
        label: thought,
        weight: thoughtScore,
        evidence_ids: evidenceIds,
      },
    ],
    summary: "A possible influence path built from stored memory evidence.",
  });
}

export function buildInfluencePathsForThought(thought, memoryStore = {}, options = {}) {
  const top = Math.max(1, Number(options.top || 4));
  const memories = Array.isArray(memoryStore.memories) ? memoryStore.memories : [];
  const candidates = memories
    .filter((memory) => memory.type === "cognitive_schema_memory" || memory.cognitive_schema)
    .map((schema) => {
      const source = (schema.sources || [])[0] || {};
      const evidencePacket = (schema.evidence_packet_ids || [])[0] || "";
      return buildInfluencePathFromMemory({
        thought,
        source: {
          ...source,
          evidence_id: evidencePacket,
          score: schema.retrieval_score ?? schema.strength,
        },
        contentUnit: {
          unit_id: evidencePacket,
          packet_id: evidencePacket,
          text: schema.summary || schema.core_interpretation || schema.label,
          evidence_id: evidencePacket,
          score: schema.strength,
        },
        concept: (schema.themes || schema.matched_markers || [schema.label])[0],
        schema,
        thoughtScore: schema.retrieval_score ?? schema.strength ?? 0.5,
      });
    })
    .filter((path) => validateInfluencePath(path).ok)
    .sort((left, right) => right.confidence - left.confidence || left.path_id.localeCompare(right.path_id));
  return candidates.slice(0, top);
}
