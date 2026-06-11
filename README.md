# Memact Memory

Memact means act-on-memory.

Memory stores the accepted user memory that survives after Wiki review. Apps
can suggest memory, Access checks permission, Context shapes it, Wiki lets the
user accept/edit/reject/delete it, and Memory stores what remains useful.

Storage is local-first today, with a path for user-owned personal cloud storage
later.

## Owns

- Durable memory records.
- User memory records.
- Accepted Wiki entries.
- App-safe summaries.
- Corrections and forgetting records.
- Retrieval for apps and user views.
- CRUD operations for memory records.
- RAG-style retrieval context for allowed app reads.
- Field-based retrieval for approved memory fragments.
- Task context packets for memory-blind local workers.

## Does Not Own

- Capture.
- Memory suggestion formation.
- Wiki moderation UI.
- API key verification.
- Full-Wiki access for apps.

## Current Code

The v0 engine supports:

- `createMemory(memoryInput, memoryStore)`
- `readMemory(memoryId, memoryStore)`
- `updateMemory(memoryId, patch, memoryStore)`
- `deleteMemory(memoryId, memoryStore)`
- `retrieveMemories(query, memoryStore, options)`
- `buildRagContext(query, memoryStore, options)`
- `buildTaskContextPacket(options)`
- `buildCapPacket(options)`
- `TemplateContextWorker.run(packet)`
- `rememberSchemaPacket(packet)`
- `rememberFeatureOutput(output)` for compatibility with older feature output records
- `retrieveContext(query, memoryStore, options)`
- `retrieveSchemaPackets(filter)`
- `buildContextForFeature(featureId, options)`
- `createCorrection(memoryId, correction)`
- `forgetMemory(memoryId, reason)`

Summary retrieval returns compact records by default. RAG context is built from
allowed memories, relation trails, and supporting snippets. Raw graph-style
retrieval is a separate permission boundary and should not be treated as the
default app response.

## Task Context Packets

Memact workers must stay memory-blind by default.

For tasks such as onboarding prefill, field mapping, or context conversion,
Memory can build a `memact.task_context_packet.v0` packet. The packet includes
only approved field fragments for one app and one connection. It filters out
pending memory, unrelated categories, raw activity dumps, full profile fields,
and sensitive fields that were not explicitly allowed.

The current worker is local and deterministic. It does not call OpenAI,
Anthropic, Gemini, or any cloud model. Future providers can plug into the same
worker interface, but they should still receive only the packet, not the full
memory store.

See `docs/task-context-workers.md`.

## CAP Packets

CAP means Context Access Protocol. It is the app-facing pipe for approved
context.

An app sends a CAP request such as "dietary restrictions" or "preferred name."
Memory only contributes approved field records. Pending proposals, raw capture
events, full profile dumps, unrelated categories, and sensitive fields without
explicit allowance are filtered out before a `memact.cap_packet.v0` packet is
made.

CAP packets include `allowed_context`, `missing_context`, and fixed forbidden
protections. They are small by design. If a future local model or embedding
worker is added, it should receive only the CAP packet, never the full memory
store.

## Development

```powershell
npm install
npm run check
```
