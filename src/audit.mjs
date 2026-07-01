import { INFLUENCE_CATEGORIES } from "./influence-categories.mjs";

// Map sibling categories to their trace attributes (with vector/space terms completely omitted)
const TRACE_ATTRIBUTES = Object.freeze({
  [INFLUENCE_CATEGORIES.EMOTIONAL_FRAMING_OVERLAP]: ["feel", "feeling", "anxious", "behind", "scared", "worried", "lonely", "angry", "sad"],
  [INFLUENCE_CATEGORIES.DECISION_CUE]: ["should", "choose", "decide", "decision", "buy", "apply", "quit", "start", "build"],
  [INFLUENCE_CATEGORIES.SOCIAL_PROOF_CUE]: ["followers", "likes", "friends", "people", "everyone", "comments", "trend", "social proof"],
  [INFLUENCE_CATEGORIES.URGENCY_CUE]: ["now", "urgent", "deadline", "limited", "before", "today", "quick", "hurry"],
  [INFLUENCE_CATEGORIES.CURIOSITY_TRIGGER]: ["why", "how", "what if", "curious", "learn", "research"],
  [INFLUENCE_CATEGORIES.NOSTALGIA_TRIGGER]: ["again", "childhood", "old", "remember", "back then", "nostalgia"],
  [INFLUENCE_CATEGORIES.ALGORITHMIC_REPETITION]: ["recommended", "for you", "feed", "algorithm", "suggested", "shorts", "reels"]
});

/**
 * Audits a text query or retrieved memory content for cross-category attribute leakage.
 * * @param {Object} context
 * @param {string} context.currentCategory - The authorized category for the current query context.
 * @param {string[]} context.capabilities - Additional categories this request context has permission to read.
 * @param {string} textToAudit - The query string or memory text to scan for trace attributes.
 * @returns {Object} Audit result { leaked: boolean, violations: Array }
 */
export function auditContextLeakage({ currentCategory, capabilities = [] }, textToAudit = "") {
  const normalizedText = String(textToAudit ?? "").toLowerCase();
  const violations = [];
  
  // Allowed categories include the current active category plus any explicitly granted capabilities
  const authorizedCategories = new Set([currentCategory, ...capabilities]);

  // Scan all categories to check for sibling attribute leaks
  for (const [category, terms] of Object.entries(TRACE_ATTRIBUTES)) {
    // If the category is authorized, it's not a leak
    if (authorizedCategories.has(category)) continue;

    // Check if any trace attributes from this unauthorized sibling category are exposed
    const matchedTerms = terms.filter(term => normalizedText.includes(term));
    
    if (matchedTerms.length > 0) {
      violations.push({
        category,
        matchedTerms,
        reason: `Exposed trace attributes of sibling category '${category}' without required capability.`
      });
    }
  }

  return {
    leaked: violations.length > 0,
    violations
  };
}