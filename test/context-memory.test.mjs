import test from "node:test"
import assert from "node:assert/strict"
import { buildContextForFeature, forgetMemory, rememberFeatureOutput, rememberInferenceRecord, rememberSchemaPacket, retrieveContext } from "../src/engine.mjs"

test("schema packet remembered", () => {
  const result = rememberSchemaPacket({ id: "shopping_discount", confidence: 0.8, support: 3, label: "Shopping Discount" })
  assert.equal(result.action.accepted, true)
})

test("feature output remembered", () => {
  const result = rememberFeatureOutput({ feature_id: "user-context-wiki", output: { summary: "A" } })
  assert.equal(result.action.accepted, true)
})

test("inference record remembered and compact context retrieved", () => {
  const result = rememberInferenceRecord({
    id: "r1",
    packet_id: "p1",
    meaningful: true,
    meaningful_score: 0.8,
    source_label: "API docs",
    canonical_themes: ["api"],
    evidence: { text_excerpt: "API docs" }
  })
  const context = retrieveContext("api", result.memoryStore)
  assert.equal(context.contract, "memact.rag_context")
})

test("forgetMemory marks record forgotten", () => {
  const created = rememberFeatureOutput({ feature_id: "research-map", output: { summary: "A" } })
  const id = created.memory.id
  const forgotten = forgetMemory(id, created.memoryStore)
  assert.equal(forgotten.memoryStore.memories.find((memory) => memory.id === id).state, "forgotten")
})

test("buildContextForFeature returns schema and context", () => {
  const result = rememberSchemaPacket({ id: "research_docs", confidence: 0.8, support: 3, label: "Research Docs" })
  const context = buildContextForFeature("research-map", result.memoryStore)
  assert.equal(context.feature_id, "research-map")
})
