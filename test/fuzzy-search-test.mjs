import assert from "node:assert";
import { retrieveMemories } from "../src/engine.mjs";

console.log("Running Large-Scale Fuzzy Search Engine Indexing Tests...");

const mockStore = {
  memories: [
    { id: "m_idx_1", label: "Production Kubernetes Cluster Deployment", strength: 0.9 },
    { id: "m_idx_2", label: "Financial Accounting Audit Ledger", strength: 0.8 }
  ]
};

// Intentionally use queries with prominent typographical errors
const resultA = retrieveMemories("Kubernets", mockStore); // Missing 'e'
const resultB = retrieveMemories("Financiall Ledger", mockStore); // Double 'l' and missing middle word

assert.ok(resultA.length > 0, "Fuzzy parser must resolve 'Kubernets' to 'Kubernetes Cluster'.");
assert.strictEqual(resultA[0].id, "m_idx_1");

assert.ok(resultB.length > 0, "Fuzzy parser must match approximate target sequence patterns.");
assert.strictEqual(resultB[0].id, "m_idx_2");

console.log("✅ Fuzzy parsing search engine tests executed perfectly!");
