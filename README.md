# Memact Memory

Memory stores useful user-context state.

It stores schema packets, feature outputs, semantic evidence, source links,
corrections, and forgetting actions. Storage is local-first today, with a path
for user-owned personal cloud storage later.

## Owns

- Durable context records.
- Schema memories.
- Feature output memories.
- Inference memories.
- Corrections and forgetting records.
- Retrieval for app/user features.

## Does Not Own

- Capture.
- Semantic inference.
- Schema formation.
- Studio feature implementation.
- API key verification.

## Development

```powershell
npm install
npm run check
```
