# Memact Memory

Version: `v0.0`

Memory is the durable store for Memact's retained evidence and virtual schema packets.

It owns one job:

```text
decide what survives and retrieve it later
```

Memory does not capture browser data, infer meaning from raw pages, or generate final answers. It stores, updates, retrieves, links, weakens, and forgets memory records.

## What This Repo Owns

- Stores meaningful activity memories.
- Stores virtual cognitive-schema memories.
- Stores first-class memory nodes, memory edges, evidence links, claims, and influence paths.
- Stores source/theme links used for retrieval.
- Exposes CRUD APIs.
- Builds compact RAG context for Website/API answers.
- Tracks confidence breakdowns, negative evidence, competing origins, graph snapshots, and source metadata.
- Tracks memory actions such as reinforcement, weakening, assimilation, accommodation, supersession, and forgetting.
- Keeps provenance so retrieved context can be traced back to evidence.

## Memory Types

- `activity_memory`
  A retained evidence packet from Inference.

- `cognitive_schema_memory`
  A virtual schema packet from Schema. This is the primary retrieval surface.

- `source_memory`
  A source node that supports a memory.

- `theme_memory`
  A theme node connecting memories.

- `memory_graph`
  Typed links between memories, sources, themes, schemas, and future queries.

- `evidence_link`
  A source URL, timestamp, snippet, score, and claim support record.

- `influence_path`
  Ordered steps from exposure to content unit, concept, schema, and thought match.

- `claim`
  An inferred statement separated from raw evidence and final wording.

## Main APIs

```text
createMemory(memory)
readMemory(id)
listMemories(filters)
updateMemory(id, patch)
deleteMemory(id, { hard })
rememberPacket(packet)
rememberSchema(schema)
retrieveCognitiveSchemas(query)
retrieveMemories(query)
buildRagContext(query, memoryStore)
createEvidenceLink(evidence)
buildInfluencePathsForThought(thought, memoryStore)
createClaim(claim)
relateMemories(a, b, relation)
reinforceMemory(id, evidence)
weakenMemory(id, reason)
forgetMemory(id)
getMemoryGraph()
createGraphSnapshot(memoryStore)
```

## RAG Context

`buildRagContext()` returns a small evidence packet:

```json
{
  "schema_version": "memact.rag_context.v0",
  "query": "why do I keep thinking about building in public?",
  "cognitive_schemas": [],
  "supporting_memories": [],
  "relation_trails": [],
  "sources": []
}
```

The context is intentionally small. If an external model is used later, it should receive this context instead of the full captured activity store.

## Evidence Authority

Memory treats evidence and graph objects as the source of truth.

AI can help word an answer later, but it should not invent sources, causes, or claims that are absent from:

- evidence links
- memory nodes
- memory edges
- influence paths
- claims
- graph snapshots

Unknown origin is a valid result when support is weak.

## Run Locally

Prerequisites:

- Node.js `20+`
- npm `10+`

Install:

```powershell
npm install
```

Validate:

```powershell
npm run check
```

Run sample:

```powershell
npm run sample
```

Run influence benchmarks:

```powershell
npm run benchmarks
```

Mermaid graph sample:

```powershell
npm run sample:mermaid
```

Run with explicit inputs:

```powershell
npm run memory -- --inference path\to\inference.json --schema path\to\schema.json --format report
```

## Storage Boundary

The current implementation is local. Storage adapters are shaped so cloud storage can be added later without changing Memory's public contract.

## License

See `LICENSE`.
