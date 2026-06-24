# Memact Memory

The secure storage and search index of Memact. It houses all approved statements for a user's profile.

## Core Responsibilities
- **Secure Persistence**: Holds approved statements securely.
- **Index & Retrieval**: Fast indexing to retrieve only relevant approved statements when queried by authorized apps.

## Database Persistence (PostgreSQL)
For production environments, Memact Memory provides a PostgreSQL adapter aligned with the V1 Supabase architecture.

### Setup
1. Run the database migration script located at `database/migration_v1.sql` to create the required `memact_memory_entries` and `memact_app_permissions` tables.
2. Initialize the adapter in your server code:
```javascript
import pg from 'pg';
import { createMemoryRepository } from 'memact-memory/storage';
import { createPostgresMemoryAdapter } from 'memact-memory/adapters/postgresql';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const memoryStore = createMemoryRepository(
  createPostgresMemoryAdapter({ pool, userId: 'user-uuid-here' })
);
```

## Local Backup & Restore
Export approved memory entries to an AES-256-GCM encrypted JSON backup, and restore them later. Only approved states (`active`, `accepted`, `approved`, `edited`, `user_verified`) are included; forgotten, superseded, deleted, and pending entries are skipped. Relations and actions that reference excluded memories are pruned so backups stay referentially consistent.

The encryption key is read from the environment:
- `MEMACT_MEMORY_ENCRYPTION_KEY` — 32-byte key as base64 or 64-char hex (required)
- `MEMACT_MEMORY_ENCRYPTION_KEY_ID` — key identifier recorded in the envelope (optional, defaults to `primary`)

```bash
# Back up a memory store to an encrypted file
node ./scripts/memory-backup.mjs backup --store memory.json --out backup.json

# Restrict the export to specific states
node ./scripts/memory-backup.mjs backup --store memory.json --out backup.json --states approved,user_verified

# Restore a memory store from an encrypted backup
node ./scripts/memory-backup.mjs restore --in backup.json --out restored.json
```

The same operations are available programmatically via `memact-memory/backup-restore` (`encryptMemoryBackup`, `decryptMemoryBackup`, `serializeApprovedMemoryBackup`).
