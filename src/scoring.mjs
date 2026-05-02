function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function round(value) {
  return Number(clamp01(value).toFixed(4));
}

export function decomposeInfluenceConfidence(input = {}) {
  const semanticMatchScore = clamp01(input.semantic_match_score ?? input.semantic ?? input.similarity, 0);
  const recencyScore = clamp01(input.recency_score ?? input.recency, 0);
  const repetitionScore = clamp01(input.repetition_score ?? input.repetition, 0);
  const sourceStrengthScore = clamp01(input.source_strength_score ?? input.source_strength, 0.5);
  const phraseOverlapScore = clamp01(input.phrase_overlap_score ?? input.phrase_overlap, 0);
  const userFeedbackScore = clamp01(input.user_feedback_score ?? input.user_feedback, 0.5);
  const uncertaintyPenalty = clamp01(input.uncertainty_penalty ?? input.penalty, 0);

  const weighted =
    semanticMatchScore * 0.26 +
    recencyScore * 0.14 +
    repetitionScore * 0.22 +
    sourceStrengthScore * 0.14 +
    phraseOverlapScore * 0.12 +
    userFeedbackScore * 0.12 -
    uncertaintyPenalty * 0.3;

  return {
    semantic_match_score: round(semanticMatchScore),
    recency_score: round(recencyScore),
    repetition_score: round(repetitionScore),
    source_strength_score: round(sourceStrengthScore),
    phrase_overlap_score: round(phraseOverlapScore),
    user_feedback_score: round(userFeedbackScore),
    uncertainty_penalty: round(uncertaintyPenalty),
    confidence: round(weighted),
    formula: "semantic*.26 + recency*.14 + repetition*.22 + source*.14 + phrase*.12 + feedback*.12 - penalty*.30",
  };
}

export function attachConfidenceBreakdown(target = {}, parts = {}) {
  const breakdown = decomposeInfluenceConfidence(parts);
  return {
    ...target,
    confidence: breakdown.confidence,
    confidence_breakdown: breakdown,
  };
}
