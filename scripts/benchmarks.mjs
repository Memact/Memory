import { readFile } from "node:fs/promises";
import { createClaim, createUnknownOriginClaim } from "../src/claims.mjs";
import { buildCompetingOriginSet } from "../src/competing-origins.mjs";
import { categorizeInfluenceLink } from "../src/influence-categories.mjs";
import { buildInfluencePathFromMemory, validateInfluencePath } from "../src/influence-paths.mjs";
import { detectNegativeEvidence } from "../src/negative-evidence.mjs";

const benchmark = JSON.parse(await readFile(new URL("../benchmarks/influence-benchmarks.json", import.meta.url), "utf8"));

const SENSITIVE_TERMS = ["medical", "patient", "bank", "password", "login", "billing", "private"];

function isSensitive(exposure = {}) {
  const text = [
    exposure.title,
    exposure.url,
    exposure.source_type,
  ].join(" ").toLowerCase();
  return Boolean(exposure.sensitive) || SENSITIVE_TERMS.some((term) => text.includes(term));
}

function strongestExposure(exposures = []) {
  return [...exposures].sort((left, right) => Number(right.score || 0) - Number(left.score || 0))[0] || null;
}

function makePath(scenario, exposure) {
  return buildInfluencePathFromMemory({
    thought: scenario.thought,
    source: {
      title: exposure.title,
      url: exposure.url,
      source_type: exposure.source_type,
      timestamp: exposure.timestamp,
      evidence_id: exposure.evidence_id,
      score: exposure.score,
    },
    contentUnit: {
      unit_id: `${scenario.id}:unit`,
      packet_id: `${scenario.id}:packet`,
      text: exposure.title,
      evidence_id: exposure.evidence_id,
      score: exposure.score,
    },
    concept: scenario.thought,
    schema: {
      id: `schema:${scenario.id}`,
      label: scenario.description,
      strength: exposure.score,
      evidence_packet_ids: [exposure.evidence_id],
    },
    thoughtScore: exposure.score,
  });
}

function runScenario(scenario) {
  const allowedExposures = scenario.exposures.filter((exposure) => !isSensitive(exposure));
  const strongest = strongestExposure(allowedExposures);
  const negativeSignals = scenario.exposures.flatMap((exposure) => detectNegativeEvidence({
    id: exposure.evidence_id,
    occurred_at: exposure.timestamp,
    token_overlap: Number(exposure.score || 0) > 0.55 ? 3 : 0,
    meaningful_score: exposure.score,
  }, {
    created_at: scenario.thought_at,
  }));
  const unknownOrigin = !strongest || Number(strongest.score || 0) < 0.5 || negativeSignals.some((signal) => signal.type === "thought_predates_exposure");
  const path = strongest && !unknownOrigin ? makePath(scenario, strongest) : null;
  const claims = allowedExposures.map((exposure) => createClaim({
    claim_id: `claim:${scenario.id}:${exposure.evidence_id}`,
    claim_type: "possible_origin",
    text: `${exposure.title} may overlap with the thought.`,
    uncertainty: "possible",
    supporting_evidence_ids: [exposure.evidence_id],
    confidence: exposure.score,
  })).filter((result) => result.ok).map((result) => result.claim);
  const competingSet = buildCompetingOriginSet({
    thought: scenario.thought,
    thought_at: scenario.thought_at,
    claims,
    evidence: allowedExposures.map((exposure) => ({
      evidence_id: exposure.evidence_id,
      timestamp: exposure.timestamp,
    })),
  });
  return {
    id: scenario.id,
    unknownOrigin,
    pathValid: path ? validateInfluencePath(path).ok : false,
    category: categorizeInfluenceLink({
      thought: scenario.thought,
      source_type: strongest?.source_type,
      repetition_count: allowedExposures.length,
      phrase_overlap_score: Number(strongest?.phrase_overlap_score || 0),
      evidence: allowedExposures.map((exposure) => ({ snippet: exposure.title })),
    }),
    negativeSignals,
    competingSet,
    excludedSensitiveCount: scenario.exposures.length - allowedExposures.length,
    unknownClaim: unknownOrigin ? createUnknownOriginClaim(scenario.thought).claim : null,
  };
}

const failures = [];

for (const scenario of benchmark.scenarios) {
  const result = runScenario(scenario);
  const expected = scenario.expected || {};
  if (expected.has_influence_path && !result.pathValid) {
    failures.push(`${scenario.id}: expected evidence-backed influence path`);
  }
  if (typeof expected.unknown_origin === "boolean" && result.unknownOrigin !== expected.unknown_origin) {
    failures.push(`${scenario.id}: expected unknown_origin=${expected.unknown_origin}`);
  }
  if (expected.category && result.category !== expected.category) {
    failures.push(`${scenario.id}: expected category ${expected.category}, got ${result.category}`);
  }
  if (expected.negative_evidence && !result.negativeSignals.some((signal) => signal.type === expected.negative_evidence)) {
    failures.push(`${scenario.id}: expected negative evidence ${expected.negative_evidence}`);
  }
  if (expected.has_competing_origins && !result.competingSet.has_competing_origins) {
    failures.push(`${scenario.id}: expected competing origins`);
  }
  if (expected.excluded_from_ai && result.excludedSensitiveCount < 1) {
    failures.push(`${scenario.id}: expected sensitive source exclusion`);
  }
  if (result.unknownOrigin && !result.unknownClaim) {
    failures.push(`${scenario.id}: expected unknown-origin claim object`);
  }
}

if (failures.length) {
  throw new Error(`Benchmark failures:\n${failures.join("\n")}`);
}

console.log(`Memact influence benchmarks passed (${benchmark.scenarios.length} scenarios).`);
