function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

export const NEGATIVE_EVIDENCE_TYPES = Object.freeze({
  TOO_OLD: "exposure_too_old",
  WEAK_TOPIC_OVERLAP: "topic_overlap_weak",
  THOUGHT_PREDATES_EXPOSURE: "thought_predates_exposure",
  LIGHTLY_SKIMMED: "source_skimmed_lightly",
  EARLIER_SIMILAR_THOUGHT: "similar_thought_existed_earlier",
  STRONGER_CONFLICTING_SOURCE: "conflicting_stronger_source",
});

export function createNegativeEvidence(type, reason, penalty = 0.1, evidenceIds = []) {
  return {
    type: normalize(type) || NEGATIVE_EVIDENCE_TYPES.WEAK_TOPIC_OVERLAP,
    reason: normalize(reason),
    penalty: clamp01(penalty, 0.1),
    evidence_ids: (Array.isArray(evidenceIds) ? evidenceIds : []).map(normalize).filter(Boolean),
  };
}

export function detectNegativeEvidence(candidate = {}, thoughtContext = {}) {
  const signals = [];
  const sourceTime = Date.parse(candidate.occurred_at || candidate.sources?.[0]?.occurred_at || "");
  const thoughtTime = Date.parse(thoughtContext.created_at || "");
  const tokenOverlap = Number(candidate.token_overlap || candidate.overlapping_terms?.length || 0);
  const meaningfulScore = Number(candidate.meaningful_score || candidate.score || 0);

  if (Number.isFinite(sourceTime) && Number.isFinite(thoughtTime) && sourceTime > thoughtTime) {
    signals.push(createNegativeEvidence(
      NEGATIVE_EVIDENCE_TYPES.THOUGHT_PREDATES_EXPOSURE,
      "The thought timestamp is earlier than this exposure.",
      0.45,
      [candidate.id]
    ));
  }
  if (tokenOverlap <= 1 && meaningfulScore < 0.5) {
    signals.push(createNegativeEvidence(
      NEGATIVE_EVIDENCE_TYPES.WEAK_TOPIC_OVERLAP,
      "The source has only weak overlap with the thought.",
      0.25,
      [candidate.id]
    ));
  }
  if (Number(candidate.duration_seconds || 0) > 0 && Number(candidate.duration_seconds || 0) < 12) {
    signals.push(createNegativeEvidence(
      NEGATIVE_EVIDENCE_TYPES.LIGHTLY_SKIMMED,
      "The source appears to have been skimmed briefly.",
      0.18,
      [candidate.id]
    ));
  }
  return signals;
}

export function applyNegativeEvidenceScore(confidence = 0, signals = []) {
  const totalPenalty = (Array.isArray(signals) ? signals : []).reduce((sum, signal) => sum + clamp01(signal.penalty), 0);
  return Number(Math.max(0, clamp01(confidence) - Math.min(0.85, totalPenalty)).toFixed(4));
}
