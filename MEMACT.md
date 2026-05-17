# Memact description

**Permissioned intent infrastructure for apps.**

```text
Understand what users are trying to do.
```

Memact is infrastructure that helps apps predict user intent from approved digital activity, without giving them raw access to a user's private data.

This repo is the Memory layer. It stores retained evidence, schema packets, graph objects, claims, and retrieval context for downstream intent-aware apps.

## System position

```text
Access -> Capture -> Inference -> Schema -> Memory -> Intent
```

Memory decides what survives and what can be retrieved later. It does not capture browser data, infer meaning from raw pages, or expose raw graph data unless Access grants the right scope.

## Copy rules

Use:

- "Permissioned intent infrastructure for apps."
- "Understand what users are trying to do."
- "approved digital activity"
- "retained evidence"
- "schema memories"
- "permissioned intent context"

Avoid:

- generic AI wrapper language
- vague memory-plugin language
- raw-data export framing
- claims that apps get the whole memory graph
- open-source wording unless the repo license explicitly says so
