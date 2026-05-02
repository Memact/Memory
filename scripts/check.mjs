import { readFile } from "node:fs/promises";
import {
  accommodateSchema,
  assimilateEvidence,
  buildMemoryStore,
  buildRagContext,
  createMemory,
  deleteMemory,
  forgetMemory,
  getMemoryTimeline,
  listMemories,
  MEMORY_RELATION_TYPES,
  queryMemoryGraph,
  readMemory,
  reinforceMemory,
  relateMemories,
  retrieveCognitiveSchemas,
  retrieveMemories,
  supersedeMemory,
  updateMemory,
} from "../src/engine.mjs";
import {
  safeIngestCoreRecord,
  validateActivityEvent,
  validateContentUnit,
  validateEvidenceLink,
  validateGraphPacket,
  validateInfluenceClaim,
  validateMemoryEdge,
  validateMemoryNode,
  validateThoughtTrace,
} from "../src/core-schemas.mjs";
import {
  claimFromInfluencePath,
  claimsForEvidence,
  createClaim,
  createUnknownOriginClaim,
  indexClaims,
  linkClaimEvidence,
} from "../src/claims.mjs";
import {
  attachEvidenceToClaim,
  collectEvidenceLinksFromMemory,
  createEvidenceLink,
  evidenceLinksForClaim,
  indexEvidenceLinks,
} from "../src/evidence-links.mjs";
import {
  buildInfluencePathFromMemory,
  buildInfluencePathsForThought,
  validateInfluencePath,
} from "../src/influence-paths.mjs";
import {
  attachConfidenceBreakdown,
  decomposeInfluenceConfidence,
} from "../src/scoring.mjs";
import {
  applyNegativeEvidenceScore,
  detectNegativeEvidence,
  NEGATIVE_EVIDENCE_TYPES,
} from "../src/negative-evidence.mjs";
import { createMemoryRepository, createRemoteMemoryAdapter } from "../src/storage.mjs";

const inference = JSON.parse(await readFile(new URL("../examples/sample-inference-output.json", import.meta.url), "utf8"));
const schema = JSON.parse(await readFile(new URL("../examples/sample-schema-output.json", import.meta.url), "utf8"));
const memory = buildMemoryStore({ inference, schema });

const validActivity = validateActivityEvent({
  id: "activity:test",
  occurred_at: "2026-04-30T10:00:00.000Z",
  title: "Startup article",
  content_text: "Reading about founder execution.",
  source_type: "article",
});
if (!validActivity.ok || validActivity.value.source_type !== "article") {
  throw new Error("Expected valid ActivityEvent schema.");
}

const invalidActivity = safeIngestCoreRecord("ActivityEvent", {
  id: "activity:bad",
  occurred_at: "not-a-date",
});
if (invalidActivity.accepted || !invalidActivity.quarantine?.errors?.length) {
  throw new Error("Expected invalid ActivityEvent to be quarantined.");
}

if (!validateContentUnit({ unit_id: "u1", text: "Repeated exposure shapes attention." }).ok) {
  throw new Error("Expected valid ContentUnit schema.");
}

if (!validateGraphPacket({
  packet_id: "packet:test",
  captured_at: "2026-04-30T10:00:00.000Z",
  content_units: [{ unit_id: "u1", text: "Repeated exposure shapes attention." }],
}).ok) {
  throw new Error("Expected valid GraphPacket schema.");
}

if (!validateMemoryNode({ id: "memory:test", type: "activity_memory", label: "Founder execution" }).ok) {
  throw new Error("Expected valid MemoryNode schema.");
}

if (!validateMemoryEdge({ from: "memory:a", to: "memory:b", type: "supports", evidence_ids: ["e1"] }).ok) {
  throw new Error("Expected valid MemoryEdge schema.");
}

if (!validateEvidenceLink({
  evidence_id: "e1",
  source_url: "https://example.com/founder",
  snippet: "Founder execution matters.",
  claim_supported: "claim:founder",
  score: 0.8,
}).ok) {
  throw new Error("Expected valid EvidenceLink schema.");
}

if (!validateInfluenceClaim({
  claim_id: "claim:test",
  claim_type: "possible_influence",
  text: "Startup reading may have contributed to the thought.",
  supporting_evidence_ids: ["e1"],
}).ok) {
  throw new Error("Expected valid InfluenceClaim schema.");
}

if (!validateThoughtTrace({ trace_id: "thought:test", thought: "I need to build something real" }).ok) {
  throw new Error("Expected valid ThoughtTrace schema.");
}

const explicitEvidence = createEvidenceLink({
  evidence_id: "evidence:explicit",
  source_url: "https://example.com/startup",
  timestamp: "2026-04-30T10:00:00.000Z",
  snippet: "Do things that do not scale.",
  claim_supported: "claim:startup",
  score: 0.92,
});
if (!explicitEvidence.ok || explicitEvidence.evidence.score !== 0.92) {
  throw new Error("Expected first-class evidence link creation.");
}

const evidenceIndex = indexEvidenceLinks([explicitEvidence.evidence]);
if (!evidenceIndex.has("evidence:explicit")) {
  throw new Error("Expected evidence link indexing.");
}

if (evidenceLinksForClaim("claim:startup", [explicitEvidence.evidence]).length !== 1) {
  throw new Error("Expected evidence retrieval by claim.");
}

const claimWithEvidence = attachEvidenceToClaim({ claim_id: "claim:startup" }, [explicitEvidence.evidence]);
if (!claimWithEvidence.supporting_evidence_ids.includes("evidence:explicit")) {
  throw new Error("Expected evidence IDs to attach to claims.");
}

if (!memory.memories.length) {
  throw new Error("Expected retained memories.");
}

if (!collectEvidenceLinksFromMemory(memory, "claim:sample").length) {
  throw new Error("Expected memory store to serialize evidence links.");
}

const sampleInfluencePath = buildInfluencePathFromMemory({
  thought: "I need to build something real",
  source: {
    title: "Do Things that Don't Scale",
    url: "https://paulgraham.com/ds.html",
    evidence_id: "evidence:pg",
    score: 0.9,
  },
  contentUnit: {
    unit_id: "u1",
    packet_id: "packet:pg",
    text: "Founders should do direct things manually.",
    evidence_id: "evidence:pg",
    score: 0.84,
  },
  concept: "founder execution",
  schema: {
    id: "schema:builder",
    label: "Builder execution frame",
    strength: 0.8,
    evidence_packet_ids: ["packet:pg"],
  },
  thoughtScore: 0.76,
});
if (!validateInfluencePath(sampleInfluencePath).ok || sampleInfluencePath.steps.length !== 5) {
  throw new Error("Expected explicit evidence-backed influence path.");
}

const pathClaim = claimFromInfluencePath(sampleInfluencePath);
if (!pathClaim.ok || !pathClaim.claim.supporting_evidence_ids.includes("evidence:pg")) {
  throw new Error("Expected influence path to produce a supported claim.");
}

const unknownClaim = createUnknownOriginClaim("why am I thinking about moving cities");
if (!unknownClaim.ok || unknownClaim.claim.claim_type !== "unknown_origin") {
  throw new Error("Expected unknown-origin claim to be valid without evidence.");
}

const linkedClaim = linkClaimEvidence(pathClaim.claim, ["evidence:extra"], {
  contradicted_by_evidence_ids: ["evidence:conflict"],
});
if (!linkedClaim.supporting_evidence_ids.includes("evidence:extra") || !linkedClaim.contradicted_by_evidence_ids.includes("evidence:conflict")) {
  throw new Error("Expected claims to track supporting and contradicting evidence separately.");
}

const claimIndex = indexClaims([pathClaim.claim, linkedClaim]);
if (!claimIndex.has(pathClaim.claim.claim_id)) {
  throw new Error("Expected claims to be indexable.");
}

if (!claimsForEvidence("evidence:pg", [pathClaim.claim]).length) {
  throw new Error("Expected evidence to resolve back to claims.");
}

if (createClaim({ claim_type: "possible_influence", text: "unsupported claim" }).ok) {
  throw new Error("Expected non-unknown claims without evidence to be rejected.");
}

const confidence = decomposeInfluenceConfidence({
  semantic_match_score: 0.8,
  recency_score: 0.5,
  repetition_score: 0.75,
  source_strength_score: 0.7,
  phrase_overlap_score: 0.25,
  user_feedback_score: 1,
  uncertainty_penalty: 0.1,
});
if (confidence.confidence <= 0 || confidence.confidence >= 1 || !confidence.formula.includes("semantic")) {
  throw new Error("Expected decomposed confidence score.");
}

const scoredPath = attachConfidenceBreakdown(sampleInfluencePath, confidence);
if (!scoredPath.confidence_breakdown || scoredPath.confidence !== confidence.confidence) {
  throw new Error("Expected confidence breakdown to attach to influence objects.");
}

const negativeSignals = detectNegativeEvidence({
  id: "candidate:late",
  occurred_at: "2026-05-02T10:00:00.000Z",
  token_overlap: 1,
  meaningful_score: 0.3,
  duration_seconds: 5,
}, {
  created_at: "2026-05-01T10:00:00.000Z",
});
if (!negativeSignals.some((signal) => signal.type === NEGATIVE_EVIDENCE_TYPES.THOUGHT_PREDATES_EXPOSURE)) {
  throw new Error("Expected thought-predates-exposure negative evidence.");
}
if (applyNegativeEvidenceScore(0.7, negativeSignals) >= 0.7) {
  throw new Error("Expected negative evidence to reduce confidence.");
}

if (!buildInfluencePathsForThought("why build something real", memory).length) {
  throw new Error("Expected influence paths to be derivable from schema memories.");
}

if (!memory.schema_packets.length) {
  throw new Error("Expected schema memories.");
}

if (!memory.graph.nodes.length || !memory.graph.edges.length) {
  throw new Error("Expected memory graph.");
}

const retrieval = retrieveMemories("why do I want to build something real", memory);
if (!retrieval.length) {
  throw new Error("Expected memory retrieval results.");
}

const cognitiveRetrieval = retrieveCognitiveSchemas("why do I need to build something real", memory);
if (!cognitiveRetrieval.length) {
  throw new Error("Expected cognitive-schema retrieval results.");
}

if (!cognitiveRetrieval[0].schema_packet_id || cognitiveRetrieval[0].type !== "cognitive_schema_memory") {
  throw new Error("Expected cognitive-schema memories to preserve schema packet identity.");
}

const rag = buildRagContext("why do I need to build something real", memory);
if (!rag.context_items.length || rag.policy.prefer_cognitive_schema_memory !== true) {
  throw new Error("Expected RAG context to prefer cognitive-schema memory.");
}

if (!Array.isArray(rag.memory_lanes.cognitive_schema) || !Array.isArray(rag.retrieval_steps)) {
  throw new Error("Expected RAG context to expose memory lanes and retrieval steps.");
}

const created = createMemory({
  id: "memory:test:manual",
  type: "activity_memory",
  label: "Manual test memory",
  summary: "A retained memory used to verify CRUD.",
  strength: 0.5,
  themes: ["test"],
}, memory);
if (!created.action.accepted || !readMemory("memory:test:manual", created.memoryStore)) {
  throw new Error("Expected create/read memory CRUD to work.");
}

const updated = updateMemory("memory:test:manual", { themes: ["crud"], strength: 0.7 }, created.memoryStore);
if (!updated.action.accepted || !listMemories(updated.memoryStore, { type: "activity_memory" }).some((item) => item.themes.includes("crud"))) {
  throw new Error("Expected update/list memory CRUD to work.");
}

const schemaId = memory.cognitive_schema_memories[0].id;
const activityId = memory.activity_memories[0].id;
const related = relateMemories(schemaId, activityId, MEMORY_RELATION_TYPES.BUILDS_ON, { reason: "test relation" }, memory);
if (!related.action.accepted || !related.relation || !related.memoryStore.relations.length) {
  throw new Error("Expected memory relation graph to accept valid edges.");
}

const assimilated = assimilateEvidence(schemaId, {
  packet_ids: ["packet:test:new"],
  sources: [{ title: "Test source", domain: "example.com" }],
  reason: "new evidence fits the schema",
}, related.memoryStore);
if (!assimilated.action.accepted || !readMemory(schemaId, assimilated.memoryStore).evidence_packet_ids.includes("packet:test:new")) {
  throw new Error("Expected schema memory to assimilate new evidence.");
}

const accommodated = accommodateSchema({
  id: "memory:schema:test-accommodated",
  label: "Accommodated test schema",
  summary: "A new schema formed because evidence did not fit the old one.",
  strength: 0.58,
  themes: ["test"],
}, { reason: "evidence required a new schema" }, assimilated.memoryStore);
if (!accommodated.action.accepted || !readMemory("memory:schema:test-accommodated", accommodated.memoryStore)?.cognitive_schema) {
  throw new Error("Expected accommodation to create a cognitive schema memory.");
}

const superseded = supersedeMemory("memory:schema:test-accommodated", {
  id: "memory:schema:test-accommodated-v2",
  summary: "Updated schema after stronger evidence.",
}, "stronger evidence updated the schema", accommodated.memoryStore);
if (!superseded.action.accepted || readMemory("memory:schema:test-accommodated", superseded.memoryStore).state !== "superseded") {
  throw new Error("Expected supersession to preserve old memory and add replacement.");
}

const graphQuery = queryMemoryGraph("test schema evidence", superseded.memoryStore);
if (!graphQuery.relation_trails.length || !getMemoryTimeline(superseded.memoryStore).length) {
  throw new Error("Expected graph query and timeline to expose relation trails.");
}

const enrichedRag = buildRagContext("test schema evidence", superseded.memoryStore);
if (!enrichedRag.relation_trails.length) {
  throw new Error("Expected RAG context to include memory relation trails.");
}

const deleted = deleteMemory("memory:test:manual", updated.memoryStore, { hard: true });
if (!deleted.action.accepted || readMemory("memory:test:manual", deleted.memoryStore)) {
  throw new Error("Expected delete memory CRUD to work.");
}

let remoteStore = memory;
const repository = createMemoryRepository(createRemoteMemoryAdapter({
  provider: "test_remote",
  async load() {
    return remoteStore;
  },
  async save(next) {
    remoteStore = next;
  },
}));
const repositoryCreate = await repository.create({
  id: "memory:test:remote",
  type: "activity_memory",
  label: "Remote storage test",
  strength: 0.5,
});
if (!repositoryCreate.action.accepted || !(await repository.read("memory:test:remote"))) {
  throw new Error("Expected remote repository adapter to support CRUD.");
}

const reinforced = reinforceMemory(memory.memories[0].id, { sources: [] }, memory);
if (!reinforced.action.accepted) {
  throw new Error("Expected reinforce action to be accepted.");
}

const forgotten = forgetMemory(memory.memories[0].id, memory);
if (!forgotten.action.accepted) {
  throw new Error("Expected forget action to be accepted.");
}

console.log("Memory check passed.");
