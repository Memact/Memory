import assert from "node:assert";
import { retrieveMemories } from "../src/engine.mjs";

console.log("Running Explainable Attribute Ranker Verification Tests...");

const mockStore = {
  memories: [
    { 
      id: "mem_1", 
      label: "User database configuration path details", 
      summary: "Stores database configs",
      strength: 0.9, 
      type: "schema_memory", 
      category: "infrastructure" 
    }
  ]
};

const results = retrieveMemories("database configuration", mockStore, {
  auditContext: { currentCategory: "infrastructure" }
});

assert.ok(results.length > 0, "Should successfully return matching items.");
const primaryResult = results[0];

assert.ok(primaryResult.ranking_weights, "Each retrieved memory must contain explainable ranking weights.");
assert.ok(primaryResult.ranking_weights.lexical_overlap > 0, "Lexical overlap attribute weight should be recorded.");
assert.strictEqual(primaryResult.ranking_weights.schema_bonus, 0.1, "Schema type weight alignment bonus should be logged.");
assert.strictEqual(primaryResult.ranking_weights.category_alignment, 0.05, "Category match alignment bonus weight should be logged.");

console.log("✅ Explainable attribute relevance ranker validation passed perfectly!");