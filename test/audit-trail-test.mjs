import assert from "node:assert";
import { retrieveMemories } from "../src/engine.mjs";

console.log("Running Query Audit Trail Compliance Verification...");

const mockStore = {
  memories: [
    { label: "Sample active node record", strength: 0.85, type: "activity_memory", state: "active" }
  ]
};

// Execute standard query with context parameters
const results = retrieveMemories("Sample", mockStore, {
  clientId: "compliance_test_client_44",
  fieldPath: "user.profile.memories"
});

assert.ok(results.auditTrailLog, "Audit trail token must be appended to retrieval outputs.");
assert.strictEqual(results.auditTrailLog.client_id, "compliance_test_client_44");
assert.strictEqual(results.auditTrailLog.queried_path, "user.profile.memories");
assert.ok(typeof results.auditTrailLog.result_count === "number");

console.log("✅ Query audit trail tracking behaves perfectly!");