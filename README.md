# Memact Memory

Version: `v0.0`

Memory is the durable store for Memact's retained evidence and virtual schema packets.
It is the shared layer that lets different Memact apps work from the same
structured memory instead of rebuilding context from scratch.

It owns one job:

```text
decide what survives and retrieve it later
```

Memory does not capture browser data, infer meaning from raw pages, or generate final answers. It stores, updates, retrieves, links, weakens, and forgets memory records.

Access decides who can ask Memact to perform work. Memory should not expose raw
nodes, edges, evidence, or graph reads unless Access has granted the app an
appropriate scope.

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
  Ordered steps that a thought-source app can use when a user asks how a thought
  may connect to earlier activity.

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

## App Surfaces

Memory is not limited to thought-origin answers. App layers can use the same
memory graph for:

- digital consumption pattern reports
- personal knowledge dictionaries from newly encountered concepts
- research maps across articles, videos, papers, searches, and notes
- decision-support checks for repeated cues or one-sided inputs
- learning timelines that show how a topic became familiar
- thought-source tracing when a user explicitly asks for it

## API Boundary

Apps should use Memact to capture allowed activity, form schemas, and retrieve
permitted summaries. Apps should not receive a blanket export of a user's
memory graph.

Access scopes define what can leave Memory:

- `memory:read_summary` for compact memory summaries
- `memory:read_evidence` for cited evidence cards
- `memory:read_graph` for permitted nodes and edges

## Evidence Authority

Memory treats evidence and graph objects as the source of truth.

AI can help word an answer later, but it should not invent sources, causes, or claims that are absent from:

- evidence links
- memory nodes
- memory edges
- influence paths
- claims
- graph snapshots

For thought-source apps, unknown origin is a valid result when support is weak.
For other apps, the answer may simply be a pattern, dictionary entry, timeline,
or memory summary.

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

The current implementation is local. Storage adapters are shaped so user-owned
cloud storage can be added later for cross-platform sync without changing
Memory's public contract. That future adapter layer is for a user's own storage
choice, such as Google Drive, iCloud, Dropbox, self-hosted S3, or another
personal backend, not for turning Memact into a central raw-data warehouse.

## License

See `LICENSE`.
