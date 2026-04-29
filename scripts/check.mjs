import { readFile } from "node:fs/promises";
import {
  accommodateSchema,
  assimilateEvidence,
  buildMemoryStore,
  buildRagContext,
  createMemory,
  deleteMemory,
  forgetMemory,
  getMemoryTimeline,
  listMemories,
  MEMORY_RELATION_TYPES,
  queryMemoryGraph,
  readMemory,
  reinforceMemory,
  relateMemories,
  retrieveCognitiveSchemas,
  retrieveMemories,
  supersedeMemory,
  updateMemory,
} from "../src/engine.mjs";
import { createMemoryRepository, createRemoteMemoryAdapter } from "../src/storage.mjs";

const inference = JSON.parse(await readFile(new URL("../examples/sample-inference-output.json", import.meta.url), "utf8"));
const schema = JSON.parse(await readFile(new URL("../examples/sample-schema-output.json", import.meta.url), "utf8"));
const memory = buildMemoryStore({ inference, schema });

if (!memory.memories.length) {
  throw new Error("Expected retained memories.");
}

if (!memory.schema_packets.length) {
  throw new Error("Expected schema memories.");
}

if (!memory.graph.nodes.length || !memory.graph.edges.length) {
  throw new Error("Expected memory graph.");
}

const retrieval = retrieveMemories("why do I want to build something real", memory);
if (!retrieval.length) {
  throw new Error("Expected memory retrieval results.");
}

const cognitiveRetrieval = retrieveCognitiveSchemas("why do I need to build something real", memory);
if (!cognitiveRetrieval.length) {
  throw new Error("Expected cognitive-schema retrieval results.");
}

if (!cognitiveRetrieval[0].schema_packet_id || cognitiveRetrieval[0].type !== "cognitive_schema_memory") {
  throw new Error("Expected cognitive-schema memories to preserve schema packet identity.");
}

const rag = buildRagContext("why do I need to build something real", memory);
if (!rag.context_items.length || rag.policy.prefer_cognitive_schema_memory !== true) {
  throw new Error("Expected RAG context to prefer cognitive-schema memory.");
}

if (!Array.isArray(rag.memory_lanes.cognitive_schema) || !Array.isArray(rag.retrieval_steps)) {
  throw new Error("Expected RAG context to expose memory lanes and retrieval steps.");
}

const created = createMemory({
  id: "memory:test:manual",
  type: "activity_memory",
  label: "Manual test memory",
  summary: "A retained memory used to verify CRUD.",
  strength: 0.5,
  themes: ["test"],
}, memory);
if (!created.action.accepted || !readMemory("memory:test:manual", created.memoryStore)) {
  throw new Error("Expected create/read memory CRUD to work.");
}

const updated = updateMemory("memory:test:manual", { themes: ["crud"], strength: 0.7 }, created.memoryStore);
if (!updated.action.accepted || !listMemories(updated.memoryStore, { type: "activity_memory" }).some((item) => item.themes.includes("crud"))) {
  throw new Error("Expected update/list memory CRUD to work.");
}

const schemaId = memory.cognitive_schema_memories[0].id;
const activityId = memory.activity_memories[0].id;
const related = relateMemories(schemaId, activityId, MEMORY_RELATION_TYPES.BUILDS_ON, { reason: "test relation" }, memory);
if (!related.action.accepted || !related.relation || !related.memoryStore.relations.length) {
  throw new Error("Expected memory relation graph to accept valid edges.");
}

const assimilated = assimilateEvidence(schemaId, {
  packet_ids: ["packet:test:new"],
  sources: [{ title: "Test source", domain: "example.com" }],
  reason: "new evidence fits the schema",
}, related.memoryStore);
if (!assimilated.action.accepted || !readMemory(schemaId, assimilated.memoryStore).evidence_packet_ids.includes("packet:test:new")) {
  throw new Error("Expected schema memory to assimilate new evidence.");
}

const accommodated = accommodateSchema({
  id: "memory:schema:test-accommodated",
  label: "Accommodated test schema",
  summary: "A new schema formed because evidence did not fit the old one.",
  strength: 0.58,
  themes: ["test"],
}, { reason: "evidence required a new schema" }, assimilated.memoryStore);
if (!accommodated.action.accepted || !readMemory("memory:schema:test-accommodated", accommodated.memoryStore)?.cognitive_schema) {
  throw new Error("Expected accommodation to create a cognitive schema memory.");
}

const superseded = supersedeMemory("memory:schema:test-accommodated", {
  id: "memory:schema:test-accommodated-v2",
  summary: "Updated schema after stronger evidence.",
}, "stronger evidence updated the schema", accommodated.memoryStore);
if (!superseded.action.accepted || readMemory("memory:schema:test-accommodated", superseded.memoryStore).state !== "superseded") {
  throw new Error("Expected supersession to preserve old memory and add replacement.");
}

const graphQuery = queryMemoryGraph("test schema evidence", superseded.memoryStore);
if (!graphQuery.relation_trails.length || !getMemoryTimeline(superseded.memoryStore).length) {
  throw new Error("Expected graph query and timeline to expose relation trails.");
}

const enrichedRag = buildRagContext("test schema evidence", superseded.memoryStore);
if (!enrichedRag.relation_trails.length) {
  throw new Error("Expected RAG context to include memory relation trails.");
}

const deleted = deleteMemory("memory:test:manual", updated.memoryStore, { hard: true });
if (!deleted.action.accepted || readMemory("memory:test:manual", deleted.memoryStore)) {
  throw new Error("Expected delete memory CRUD to work.");
}

let remoteStore = memory;
const repository = createMemoryRepository(createRemoteMemoryAdapter({
  provider: "test_remote",
  async load() {
    return remoteStore;
  },
  async save(next) {
    remoteStore = next;
  },
}));
const repositoryCreate = await repository.create({
  id: "memory:test:remote",
  type: "activity_memory",
  label: "Remote storage test",
  strength: 0.5,
});
if (!repositoryCreate.action.accepted || !(await repository.read("memory:test:remote"))) {
  throw new Error("Expected remote repository adapter to support CRUD.");
}

const reinforced = reinforceMemory(memory.memories[0].id, { sources: [] }, memory);
if (!reinforced.action.accepted) {
  throw new Error("Expected reinforce action to be accepted.");
}

const forgotten = forgetMemory(memory.memories[0].id, memory);
if (!forgotten.action.accepted) {
  throw new Error("Expected forget action to be accepted.");
}

console.log("Memory check passed.");
