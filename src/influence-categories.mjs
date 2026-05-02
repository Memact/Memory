function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

export const INFLUENCE_CATEGORIES = Object.freeze({
  DIRECT_PHRASE_OVERLAP: "direct_phrase_overlap",
  REPEATED_TOPIC_EXPOSURE: "repeated_topic_exposure",
  EMOTIONAL_FRAMING_OVERLAP: "emotional_framing_overlap",
  DECISION_CUE: "decision_cue",
  SOCIAL_PROOF_CUE: "social_proof_cue",
  URGENCY_CUE: "urgency_cue",
  CURIOSITY_TRIGGER: "curiosity_trigger",
  NOSTALGIA_TRIGGER: "nostalgia_trigger",
  ALGORITHMIC_REPETITION: "algorithmic_repetition",
  SELF_REPORTED_ORIGIN: "self_reported_origin",
  POSSIBLE_MEMORY_INFLUENCE: "possible_memory_influence",
});

const EMOTION_TERMS = ["feel", "feeling", "anxious", "behind", "scared", "worried", "lonely", "angry", "sad"];
const DECISION_TERMS = ["should", "choose", "decide", "decision", "buy", "apply", "quit", "start", "build"];
const SOCIAL_TERMS = ["followers", "likes", "friends", "people", "everyone", "comments", "trend", "social proof"];
const URGENCY_TERMS = ["now", "urgent", "deadline", "limited", "before", "today", "quick", "hurry"];
const CURIOSITY_TERMS = ["why", "how", "what if", "curious", "learn", "research"];
const NOSTALGIA_TERMS = ["again", "childhood", "old", "remember", "back then", "nostalgia"];
const ALGORITHMIC_TERMS = ["recommended", "for you", "feed", "algorithm", "suggested", "shorts", "reels"];

export function categorizeInfluenceLink(input = {}) {
  const thought = normalize(input.thought);
  const labelText = normalize([
    input.label,
    input.summary,
    input.source_type,
    ...(Array.isArray(input.steps) ? input.steps.map((step) => `${step.type} ${step.label}`) : []),
    ...(Array.isArray(input.evidence) ? input.evidence.map((item) => item.snippet || item.text || item.title) : []),
  ].filter(Boolean).join(" "));
  const text = `${thought} ${labelText}`;
  const explicitType = normalize(input.source_type || input.type);
  const repetition = Number(input.repetition_count ?? input.count ?? input.frequency ?? 0);
  const phraseHits = Number(input.phrase_overlap_score ?? input.exact_phrase_hits ?? 0);

  if (explicitType.includes("self") || text.includes("self report") || text.includes("survey")) {
    return INFLUENCE_CATEGORIES.SELF_REPORTED_ORIGIN;
  }
  if (phraseHits >= 0.55 || input.direct_phrase_overlap === true) {
    return INFLUENCE_CATEGORIES.DIRECT_PHRASE_OVERLAP;
  }
  if (repetition >= 3 || hasAny(text, ALGORITHMIC_TERMS)) {
    return hasAny(text, ALGORITHMIC_TERMS)
      ? INFLUENCE_CATEGORIES.ALGORITHMIC_REPETITION
      : INFLUENCE_CATEGORIES.REPEATED_TOPIC_EXPOSURE;
  }
  if (hasAny(text, SOCIAL_TERMS)) {
    return INFLUENCE_CATEGORIES.SOCIAL_PROOF_CUE;
  }
  if (hasAny(text, URGENCY_TERMS)) {
    return INFLUENCE_CATEGORIES.URGENCY_CUE;
  }
  if (hasAny(text, EMOTION_TERMS)) {
    return INFLUENCE_CATEGORIES.EMOTIONAL_FRAMING_OVERLAP;
  }
  if (hasAny(text, DECISION_TERMS)) {
    return INFLUENCE_CATEGORIES.DECISION_CUE;
  }
  if (hasAny(text, NOSTALGIA_TERMS)) {
    return INFLUENCE_CATEGORIES.NOSTALGIA_TRIGGER;
  }
  if (hasAny(text, CURIOSITY_TERMS)) {
    return INFLUENCE_CATEGORIES.CURIOSITY_TRIGGER;
  }
  return INFLUENCE_CATEGORIES.POSSIBLE_MEMORY_INFLUENCE;
}

export function applyInfluenceCategory(link = {}) {
  const category = link.category && link.category !== "unclassified"
    ? link.category
    : categorizeInfluenceLink(link);
  return {
    ...link,
    category,
    influence_category: category,
  };
}

export function explainInfluenceCategory(category) {
  const explanations = {
    [INFLUENCE_CATEGORIES.DIRECT_PHRASE_OVERLAP]: "matched wording appeared in captured activity",
    [INFLUENCE_CATEGORIES.REPEATED_TOPIC_EXPOSURE]: "the topic appeared repeatedly",
    [INFLUENCE_CATEGORIES.EMOTIONAL_FRAMING_OVERLAP]: "the activity and thought share emotional framing",
    [INFLUENCE_CATEGORIES.DECISION_CUE]: "the activity overlaps with a decision cue",
    [INFLUENCE_CATEGORIES.SOCIAL_PROOF_CUE]: "the activity includes social proof cues",
    [INFLUENCE_CATEGORIES.URGENCY_CUE]: "the activity includes urgency cues",
    [INFLUENCE_CATEGORIES.CURIOSITY_TRIGGER]: "the activity overlaps with a curiosity cue",
    [INFLUENCE_CATEGORIES.NOSTALGIA_TRIGGER]: "the activity overlaps with nostalgia cues",
    [INFLUENCE_CATEGORIES.ALGORITHMIC_REPETITION]: "the activity appears repeatedly through feed or recommendation patterns",
    [INFLUENCE_CATEGORIES.SELF_REPORTED_ORIGIN]: "the link comes from a user self-report",
    [INFLUENCE_CATEGORIES.POSSIBLE_MEMORY_INFLUENCE]: "the activity is a possible memory influence",
  };
  return explanations[category] || explanations[INFLUENCE_CATEGORIES.POSSIBLE_MEMORY_INFLUENCE];
}
