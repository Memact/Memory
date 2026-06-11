import test from "node:test"
import assert from "node:assert/strict"
import { TemplateContextWorker } from "../src/context-worker.mjs"
import { buildContextForFeature, forgetMemory, rememberFeatureOutput, rememberInferenceRecord, rememberSchemaPacket, retrieveContext } from "../src/engine.mjs"
import { buildCapPacket, retrieveApprovedContextFields } from "../src/cap-packet.mjs"
import { semanticMatchingExamples } from "../src/semantic-matching.mjs"
import { buildTaskContextPacket, filterApprovedTaskMemory } from "../src/task-context-packet.mjs"

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

test("reading schema packet becomes reading preference memory", () => {
  const result = rememberSchemaPacket({
    packet_id: "schema_reading_preferences_1",
    category: "reading",
    schema_type: "reading_preferences",
    confidence: 0.82,
    attributes: {
      preferred_topics: ["ai policy"],
      skipped_topics: ["celebrity"],
      average_scroll_depth: 88,
      finish_rate: 0.82,
      preferred_article_length: "long",
      preferred_summary_style: "deep_dive",
      repeat_topics: ["ai policy"]
    },
    sources: [{ id: "evt_1", title: "AI policy guide" }]
  })
  assert.equal(result.memory.type, "reading_preference_memory")
  const context = buildContextForFeature("adaptive-article-overview", result.memoryStore)
  assert.equal(context.reading_memory.preferred_summary_style, "deep_dive")
  assert.equal(context.reading_memory.preferred_topics[0], "ai policy")
})

test("adaptive article overview output is stored", () => {
  const result = rememberFeatureOutput({
    feature_id: "adaptive-article-overview",
    output: { summary_style: "key_points", overview: "Key points: A" },
    confidence: 0.7
  })
  assert.equal(result.memory.type, "feature_output_memory")
  assert.equal(result.memory.feature_id, "adaptive-article-overview")
})

test("task context packet filters to approved field memory only", () => {
  const memoryRecords = [
    {
      id: "mem_diet_pref",
      field_path: "diet.preference",
      value: "vegetarian",
      category: "fitness",
      status: "accepted",
      sensitivity: "normal",
      allowed_app_ids: ["nutriplan-lite"],
      allowed_actor_types: ["memact_worker"],
      source_app_id: "user"
    },
    {
      id: "mem_pending",
      field_path: "fitness.goal",
      value: "muscle gain",
      category: "fitness",
      status: "pending",
      sensitivity: "normal",
      allowed_app_ids: ["nutriplan-lite"]
    },
    {
      id: "mem_raw",
      field_path: "raw_capture_events",
      value: "raw timeline",
      category: "fitness",
      status: "accepted",
      sensitivity: "high",
      allowed_app_ids: ["nutriplan-lite"]
    },
    {
      id: "mem_other_app",
      field_path: "diet.allergy",
      value: "peanuts",
      category: "fitness",
      status: "accepted",
      sensitivity: "sensitive",
      allowed_app_ids: ["other-app"]
    }
  ]

  const approved = filterApprovedTaskMemory(memoryRecords, {
    target_app_id: "nutriplan-lite",
    categories: ["fitness"],
    actor: { type: "memact_worker" }
  })
  assert.equal(approved.length, 1)
  assert.equal(approved[0].field_path, "diet.preference")

  const packet = buildTaskContextPacket({
    target_app_id: "nutriplan-lite",
    connection_id: "conn_123",
    purpose: "onboarding_prefill",
    requested_fields: ["food restrictions"],
    categories: ["fitness"],
    approved_memory_records: memoryRecords
  })
  assert.equal(packet.schema_version, "memact.task_context_packet.v0")
  assert.equal(packet.retention, "none")
  assert.deepEqual(packet.forbidden_context, ["full_profile", "raw_capture_events", "unapproved_memory"])
  assert.equal(packet.allowed_context.length, 1)
  assert.equal(packet.allowed_context[0].field_path, "diet.preference")
})

test("template worker runs on packet without full memory access", async () => {
  const packet = buildTaskContextPacket({
    target_app_id: "nutriplan-lite",
    connection_id: "conn_123",
    purpose: "onboarding_prefill",
    requested_fields: ["food restrictions"],
    categories: ["fitness"],
    approved_memory_records: [
      {
        field_path: "diet.allergy",
        value: "peanuts",
        category: "fitness",
        status: "accepted",
        sensitivity: "sensitive",
        allowed_app_ids: ["nutriplan-lite"],
        allowed_actor_types: ["memact_worker"]
      }
    ],
    allowedSensitiveFieldPaths: ["diet.allergy"]
  })
  const worker = new TemplateContextWorker()
  const result = await worker.run(packet)
  assert.equal(result.status, "ok")
  assert.equal(result.safety.memory_blind, true)
  assert.equal(result.safety.received_full_profile, false)
  assert.equal(result.output.fields["diet.allergy"], "peanuts")
})

test("template worker also runs on CAP packets without full memory access", async () => {
  const packet = buildCapPacket({
    cap_request: {
      request_id: "cap_req_worker",
      app_id: "food-app",
      connection_id: "con_1",
      purpose: "onboarding_prefill",
      requested_categories: ["food"],
      requested_context: [{ description: "food restrictions", required: true }]
    },
    approved_memory_records: [
      { field_path: "diet.preference", value: "vegetarian", category: "food", status: "approved", sensitivity: "normal", allowed_app_ids: ["food-app"] }
    ]
  })
  const worker = new TemplateContextWorker()
  const result = await worker.run(packet)
  assert.equal(result.status, "ok")
  assert.equal(result.target_app_id, "food-app")
  assert.equal(result.safety.memory_blind, true)
  assert.equal(result.output.fields["diet.preference"], "vegetarian")
})

test("semantic matching examples include NutriPlan-friendly food restrictions mapping", () => {
  const example = semanticMatchingExamples.find((item) => item.app_field === "food restrictions")
  assert.ok(example)
  assert.deepEqual(example.memact_fields, ["diet.preference", "diet.allergy"])
})

test("CAP retrieval returns approved field memory only", () => {
  const records = [
    { field_path: "diet.preference", value: "vegetarian", category: "food", status: "approved", sensitivity: "normal", allowed_app_ids: ["food-app"] },
    { field_path: "diet.allergy", value: "peanuts", category: "food", status: "pending", sensitivity: "sensitive", allowed_app_ids: ["food-app"] },
    { field_path: "shopping.budget", value: "low", category: "shopping", status: "approved", sensitivity: "normal", allowed_app_ids: ["food-app"] },
    { field_path: "raw_capture_events", value: "raw event dump", category: "food", status: "approved", sensitivity: "normal", allowed_app_ids: ["food-app"] }
  ]
  const approved = retrieveApprovedContextFields(records, {
    app_id: "food-app",
    requested_categories: ["food"]
  })
  assert.deepEqual(approved.map((item) => item.field_path), ["diet.preference"])
})

test("CAP packet includes allowed and missing context without full profile", () => {
  const packet = buildCapPacket({
    cap_request: {
      request_id: "cap_req_1",
      app_id: "food-app",
      connection_id: "con_1",
      purpose: "onboarding_prefill",
      requested_categories: ["food"],
      requested_context: [
        { description: "food restrictions", required: true },
        { description: "cuisine preference", required: false }
      ]
    },
    approved_memory_records: [
      { field_path: "diet.preference", value: "vegetarian", category: "food", status: "approved", sensitivity: "normal", allowed_app_ids: ["food-app"], confidence: 0.9 },
      { field_path: "profile", value: { full_profile: true }, category: "all", status: "approved", sensitivity: "high", allowed_app_ids: ["food-app"] }
    ]
  })
  assert.equal(packet.schema_version, "memact.cap_packet.v0")
  assert.equal(packet.allowed_context.length, 1)
  assert.equal(packet.allowed_context[0].field_path, "diet.preference")
  assert.equal(packet.missing_context[0].description, "cuisine preference")
  assert.deepEqual(packet.forbidden_context, ["full_profile", "raw_capture_events", "unapproved_memory"])
})
