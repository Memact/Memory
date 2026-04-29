# Memact Memory

Version: `v0.0`

Memory is the durable survival layer in the Memact architecture.

It answers:

`What should survive across future interactions, models, and apps?`

Memory stores meaningful activity packets and virtual cognitive-schema packets. It does not store random browsing as memory. It keeps provenance, strength, decay, formation metrics, graph links, and CRUD/RAG surfaces so future models and apps can act from evidence instead of guessing.

## Pipeline Position

```text
Capture -> Inference -> Memory -> Schema -> Interface / Query -> Origin / Influence -> Action -> Memory
```

Memory sits after Schema because raw activity should not automatically survive as long-term memory. Inference decides what is meaningful. Schema induces virtual cognitive schemas. Memory decides what persists, merges, strengthens, fades, gets retrieved, or gets forgotten.

In product terms, Memory is where Memact keeps the virtual cognitive schemas. These are not medical claims. They are evidence-backed mirrors of repeated frames that may be shaping how a user reads ideas, feelings, and decisions.

The cognitive-science principle is simple: new evidence can be assimilated into an existing schema, or it can force accommodation by creating/changing a schema. Memory keeps that update path explicit and auditable.

## What It Stores

- `activity_memory`
  Meaningful activity packets from Inference.
- `cognitive_schema_memory`
  Virtual cognitive-schema packets from Schema. This is the primary retrieval surface for answering user questions. It preserves the core interpretation, action tendency, emotional signature, marker groups, evidence packets, and source provenance.
- `source_memory`
  Source nodes that support memories.
- `theme_memory`
  Canonical themes that connect packets and schemas.
- `memory_graph`
  Links between packets, schemas, sources, themes, and future thought queries.

## RAG And CRUD

Memory exposes direct CRUD and RAG APIs. Apps can use them locally today and through a cloud adapter later.

```text
createMemory(memory)
readMemory(id)
listMemories(filters)
updateMemory(id, patch)
deleteMemory(id, { hard })
buildRagContext(query, memoryStore)
rememberPacket(packet)
rememberSchema(schema)
retrieveCognitiveSchemas(query)
retrieveMemories(query)
linkMemories(a, b)
reinforceMemory(id, evidence)
weakenMemory(id, reason)
forgetMemory(id)
explainMemory(id)
getMemoryGraph()
```

`buildRagContext()` is the retrieval packet for answer generation. It prefers cognitive-schema memory, then attaches supporting activity/source memories. Gemini or another model can receive this minimized context, but not the full captured activity store.

## Controlled Memory Actions

Models and apps can propose memory actions, but Memory validates them deterministically.

The model can act on memory, but it should not freely rewrite memory. Every action keeps an audit event and must preserve provenance.

## Storage Boundary

Memory is storage-agnostic. The engine works on a plain memory store object. `src/storage.mjs` adds adapters:

- `createJsonFileMemoryAdapter(path)`
- `createRemoteMemoryAdapter({ load, save, provider })`
- `createMemoryRepository(adapter)`

This keeps the future open for Google Drive, Supabase, S3, user-owned cloud storage, or encrypted local-first sync. The storage layer can save/retrieve memory stores, but it must not bypass CRUD, provenance, or RAG policy.

## Public Output Contract

```json
{
  "schema_version": "memact.memory.v0",
  "memories": [
    {
      "id": "memory:activity:packet-act-1",
      "type": "activity_memory",
      "label": "YC founder interview about shipping MVPs",
      "strength": 0.63,
      "survival_score": 0.63,
      "source_packet_id": "packet:act_1",
      "themes": ["startup"],
      "sources": []
    }
  ],
  "schema_packets": [
    {
      "id": "memory:schema:builder_agency",
      "type": "cognitive_schema_memory",
      "label": "Builder / agency schema",
      "virtual": true,
      "cognitive_schema": true,
      "core_interpretation": "Progress feels real when it becomes built, shipped, or visible.",
      "action_tendency": "move toward building, debugging, launching, proving, or showing work",
      "strength": 0.72,
      "support": 4
    }
  ],
  "graph": {
    "nodes": [],
    "edges": []
  },
  "actions": []
}
```

## Terminal Quickstart

Prerequisites:

- Node.js `20+`
- npm `10+`

Install:

```powershell
npm install
```

Run validation:

```powershell
npm run check
```

Run sample:

```powershell
npm run sample
```

Build memory JSON:

```powershell
npm run memory -- --inference ..\inference-output.json --schema ..\schema-output.json --format json
```

Build a RAG context for a thought:

```powershell
npm run memory -- --inference examples\sample-inference-output.json --schema examples\sample-schema-output.json --query "why do I need to build something real" --format json
```

## Design Rules

- memory is not raw storage
- memory stores what survives after deterministic gates
- cognitive-schema memories are virtual schema mirrors, not diagnoses
- RAG starts from cognitive-schema memory and returns a minimized evidence packet
- CRUD actions are explicit and auditable
- storage adapters must not bypass memory policy
- retrieval should prefer cognitive-schema memory first, then use activity/source packets as evidence
- every memory must keep provenance
- actions are explicit and auditable
- models can propose, Memory validates
- forgetting and weakening are first-class operations

## License

See `LICENSE`.
