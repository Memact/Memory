import assert from "node:assert";
import { buildMemoryStore } from "../src/engine.mjs";

console.log("Running TTL Expiration Decision Explanation Tests...");

// Create a mock old record to trigger the 30-day rule
const aMonthAgo = new Date();
aMonthAgo.setDate(aMonthAgo.getDate() - 32);

const mockMemoryStoreInput = {
  previousMemory: {
    memories: [
      {
        id: "memory:activity:old-node",
        type: "activity_memory",
        label: "Stale data asset",
        strength: 0.5,
        first_seen_at: aMonthAgo.toISOString(),
        last_seen_at: aMonthAgo.toISOString(),
        state: "active"
      }
    ]
  }
};

const store = buildMemoryStore(mockMemoryStoreInput);
const evaluatedNode = store.memories.find(m => m.id === "memory:activity:old-node");

assert.strictEqual(evaluatedNode.state, "forgotten", "Stale nodes should be marked forgotten.");
assert.ok(evaluatedNode.decay.expiration_reason.includes("Inactive for 32 days"), "Should log the explicit expiration reason.");

console.log("✅ Automated TTL expiration explanation logs successfully!");
