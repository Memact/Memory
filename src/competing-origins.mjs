function normalize(value, maxLength = 0) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return maxLength && text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function slug(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "claim_set";
}

function parseTime(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function unique(values = []) {
  return [...new Set(values.map((value) => normalize(value)).filter(Boolean))];
}

function firstEvidenceTime(claim = {}, evidenceById = new Map()) {
  const evidenceIds = claim.supporting_evidence_ids || claim.evidence_ids || [];
  return evidenceIds
    .map((id) => evidenceById.get(id)?.timestamp || evidenceById.get(id)?.occurred_at || evidenceById.get(id)?.captured_at)
    .map(parseTime)
    .filter(Boolean)
    .sort((left, right) => left - right)[0] || 0;
}

export function detectOriginContradictions({
  thought_at = "",
  claims = [],
  evidence = [],
} = {}) {
  const evidenceById = new Map((Array.isArray(evidence) ? evidence : []).map((item) => [item.evidence_id || item.id, item]));
  const thoughtTime = parseTime(thought_at);
  const sortedClaims = [...(Array.isArray(claims) ? claims : [])]
    .map((claim) => ({
      claim,
      confidence: Number(claim.confidence ?? claim.score ?? 0),
      first_evidence_time: firstEvidenceTime(claim, evidenceById),
    }))
    .sort((left, right) => right.confidence - left.confidence);
  const strongest = sortedClaims[0];
  const contradictions = [];

  for (const item of sortedClaims) {
    if (thoughtTime && item.first_evidence_time && item.first_evidence_time > thoughtTime) {
      contradictions.push({
        type: "thought_predates_exposure",
        claim_id: item.claim.claim_id,
        severity: 0.9,
        reason: "the thought timestamp is earlier than the supporting exposure",
        evidence_ids: unique(item.claim.supporting_evidence_ids || []),
      });
    }
    if (strongest && strongest.claim.claim_id !== item.claim.claim_id && strongest.confidence - item.confidence >= 0.18) {
      contradictions.push({
        type: "stronger_competing_source",
        claim_id: item.claim.claim_id,
        competing_claim_id: strongest.claim.claim_id,
        severity: Number(Math.min(1, strongest.confidence - item.confidence).toFixed(4)),
        reason: "a competing source has materially stronger support",
        evidence_ids: unique([...(item.claim.supporting_evidence_ids || []), ...(strongest.claim.supporting_evidence_ids || [])]),
      });
    }
  }

  return contradictions;
}

export function buildCompetingOriginSet({
  thought = "",
  thought_at = "",
  claims = [],
  evidence = [],
} = {}) {
  const validClaims = (Array.isArray(claims) ? claims : []).filter((claim) => claim?.claim_id);
  const rankedClaims = [...validClaims]
    .sort((left, right) => Number(right.confidence ?? right.score ?? 0) - Number(left.confidence ?? left.score ?? 0));
  const contradictions = detectOriginContradictions({ thought_at, claims: rankedClaims, evidence });
  const contradictionByClaim = new Map();
  contradictions.forEach((contradiction) => {
    const list = contradictionByClaim.get(contradiction.claim_id) || [];
    list.push(contradiction);
    contradictionByClaim.set(contradiction.claim_id, list);
  });
  const annotatedClaims = rankedClaims.map((claim) => ({
    ...claim,
    contradicted_by: [
      ...(claim.contradicted_by || []),
      ...(contradictionByClaim.get(claim.claim_id) || []),
    ],
    competing_claim_ids: rankedClaims
      .filter((candidate) => candidate.claim_id !== claim.claim_id)
      .slice(0, 3)
      .map((candidate) => candidate.claim_id),
  }));

  return {
    schema_version: "memact.competing_origin_set.v1",
    claim_set_id: `origin_set:${slug(thought || rankedClaims.map((claim) => claim.claim_id).join("_"))}`,
    thought: normalize(thought, 600),
    thought_at: normalize(thought_at, 80),
    primary_claim_id: annotatedClaims[0]?.claim_id || "",
    competing_claim_ids: annotatedClaims.slice(1).map((claim) => claim.claim_id),
    claims: annotatedClaims,
    contradictions,
    evidence_ids: unique(annotatedClaims.flatMap((claim) => claim.supporting_evidence_ids || [])),
    has_competing_origins: annotatedClaims.length > 1,
    has_contradictions: contradictions.length > 0,
  };
}
