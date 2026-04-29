#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { buildMemoryStore, formatMemoryReport, retrieveMemories } from "./engine.mjs";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function readJson(path) {
  if (!path) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

const inferencePath = argValue("--inference");
const schemaPath = argValue("--schema");
const previousPath = argValue("--memory");
const query = argValue("--query");
const format = argValue("--format", "report");

if (!inferencePath && !schemaPath) {
  console.error("Usage: memact-memory --inference inference.json --schema schema.json [--memory memory.json] [--query thought] [--format report|json]");
  process.exit(1);
}

const memoryStore = buildMemoryStore({
  inference: await readJson(inferencePath),
  schema: await readJson(schemaPath),
  previousMemory: await readJson(previousPath),
});

if (query) {
  const result = retrieveMemories(query, memoryStore);
  if (format === "json") {
    console.log(JSON.stringify({ query, memories: result }, null, 2));
  } else {
    console.log(`Memact Memory Retrieval\nQuery: ${query}\n`);
    if (!result.length) {
      console.log("No retained memories matched.");
    } else {
      result.forEach((memory, index) => {
        console.log(`${index + 1}. ${memory.label}`);
        console.log(`   type=${memory.type} score=${memory.retrieval_score.toFixed(3)} strength=${memory.strength.toFixed(3)}`);
      });
    }
  }
} else if (format === "json") {
  console.log(JSON.stringify(memoryStore, null, 2));
} else {
  console.log(formatMemoryReport(memoryStore));
}
