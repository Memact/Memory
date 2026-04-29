import { readFile } from "node:fs/promises";
import {
  buildMemoryStore,
  forgetMemory,
  reinforceMemory,
  retrieveMemories,
} from "../src/engine.mjs";

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

const reinforced = reinforceMemory(memory.memories[0].id, { sources: [] }, memory);
if (!reinforced.action.accepted) {
  throw new Error("Expected reinforce action to be accepted.");
}

const forgotten = forgetMemory(memory.memories[0].id, memory);
if (!forgotten.action.accepted) {
  throw new Error("Expected forget action to be accepted.");
}

console.log("Memory check passed.");
