import assert from "node:assert";
import { auditContextLeakage } from "../src/audit.mjs";
import { INFLUENCE_CATEGORIES } from "../src/influence-categories.mjs";

console.log("Running Context Attribute Leakage Audit Tests...");

// Test Case 1: Safe request within category scope
const safeContext = {
  currentCategory: INFLUENCE_CATEGORIES.URGENCY_CUE,
  capabilities: []
};
const safeResult = auditContextLeakage(safeContext, "This must be done now before the deadline!");
assert.strictEqual(safeResult.leaked, false, "Should not flag leakage for allowed category terms.");

// Test Case 2: Leakage detection across sibling category
const leakingContext = {
  currentCategory: INFLUENCE_CATEGORIES.URGENCY_CUE,
  capabilities: []
};
// 'anxious' and 'worried' belong to EMOTIONAL_FRAMING_OVERLAP (a sibling category)
const leakResult = auditContextLeakage(leakingContext, "Urgent deadline, I am feeling anxious and worried.");
assert.strictEqual(leakResult.leaked, true, "Should detect sibling attribute leakage.");
assert.strictEqual(leakResult.violations[0].category, INFLUENCE_CATEGORIES.EMOTIONAL_FRAMING_OVERLAP);

console.log("✅ All context leakage audit tests passed successfully!");