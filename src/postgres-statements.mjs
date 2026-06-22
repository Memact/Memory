import {
  decryptJson,
  encryptJson,
  loadEncryptionKeyFromEnv,
  loadEncryptionKeyIdFromEnv,
} from "./field-encryption.mjs";

export const MEMORY_STATEMENTS_TABLE = "memact_memory_statements";

export const MEMORY_STATEMENTS_DDL = `-- sql/memory_statements.sql`;

export const PUBLIC_STATEMENT_COLUMNS = Object.freeze([
  "id",
  "memory_type",
  "field_path",
  "category",
  "status",
  "sensitivity",
  "label",
  "strength",
  "state",
  "source_app_id",
  "allowed_app_ids",
  "allowed_actor_types",
  "first_seen_at",
  "last_seen_at",
]);

export const SENSITIVE_STATEMENT_FIELDS = Object.freeze([
  "summary",
  "value",
  "attributes",
  "provenance",
  "sources",
  "themes",
  "reasons",
  "survival_score",
  "meaningful_score",
  "source_packet_id",
  "source_record_id",
  "schema_id",
  "schema_packet_id",
  "schema_state",
  "state_label",
  "core_interpretation",
  "action_tendency",
  "emotional_signature",
  "marker_categories",
  "matched_markers",
  "formation_basis",
  "formation_metrics",
  "support",
  "confidence",
  "evidence_packet_ids",
  "intent_id",
  "intent_category",
  "confidence_level",
  "confidence_basis",
  "evidence_ids",
  "evidence",
  "alternative_intents",
  "allowed_actions",
  "blocked_actions",
  "notes",
  "safety",
  "schema_refs",
  "feature_refs",
  "evidence_refs",
  "feature_id",
  "decay",
  "virtual",
  "cognitive_schema",
  "path",
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function omitFields(record, keys) {
  const blocked = new Set(keys);
  const output = { ...record };
  for (const key of blocked) {
    delete output[key];
  }
  return output;
}

export function splitMemoryStatement(memory = {}) {
  const record = asObject(memory);
  const publicRow = {
    id: record.id,
    memory_type: record.type,
    field_path: record.field_path || record.path || null,
    category: record.category || null,
    status: record.status || record.state || "active",
    sensitivity: record.sensitivity || "normal",
    label: record.label || record.id,
    strength: record.strength ?? null,
    state: record.state || "active",
    source_app_id: record.source_app_id || null,
    allowed_app_ids: Array.isArray(record.allowed_app_ids) ? record.allowed_app_ids : [],
    allowed_actor_types: Array.isArray(record.allowed_actor_types) ? record.allowed_actor_types : ["memact_worker"],
    first_seen_at: record.first_seen_at || null,
    last_seen_at: record.last_seen_at || null,
  };

  const sensitivePayload = omitFields(record, [
    "id",
    "type",
    "field_path",
    "path",
    "category",
    "status",
    "sensitivity",
    "label",
    "strength",
    "state",
    "source_app_id",
    "allowed_app_ids",
    "allowed_actor_types",
    "first_seen_at",
    "last_seen_at",
  ]);

  return { publicRow, sensitivePayload };
}

export function mergeMemoryStatement(publicRow = {}, sensitivePayload = {}) {
  return {
    id: publicRow.id,
    type: publicRow.memory_type,
    field_path: publicRow.field_path || undefined,
    category: publicRow.category || undefined,
    status: publicRow.status || undefined,
    sensitivity: publicRow.sensitivity || "normal",
    label: publicRow.label,
    strength: publicRow.strength ?? undefined,
    state: publicRow.state || "active",
    source_app_id: publicRow.source_app_id || undefined,
    allowed_app_ids: publicRow.allowed_app_ids || [],
    allowed_actor_types: publicRow.allowed_actor_types || ["memact_worker"],
    first_seen_at: publicRow.first_seen_at || undefined,
    last_seen_at: publicRow.last_seen_at || undefined,
    ...sensitivePayload,
  };
}

export function encryptStatementRow(memory, options = {}) {
  const key = options.key || loadEncryptionKeyFromEnv(options.env);
  const keyId = options.keyId || loadEncryptionKeyIdFromEnv(options.env);
  const { publicRow, sensitivePayload } = splitMemoryStatement(memory);
  const encrypted = encryptJson(sensitivePayload, { key, keyId });

  return {
    ...publicRow,
    sensitive_payload: encrypted.ciphertext,
    payload_iv: encrypted.iv,
    payload_tag: encrypted.tag,
    encryption_key_id: encrypted.key_id,
  };
}

export function decryptStatementRow(row, options = {}) {
  const key = options.key || loadEncryptionKeyFromEnv(options.env);
  const sensitivePayload = decryptJson({
    ciphertext: row.sensitive_payload,
    iv: row.payload_iv,
    tag: row.payload_tag,
  }, key);

  return mergeMemoryStatement(row, sensitivePayload);
}

const UPSERT_SQL = `
INSERT INTO ${MEMORY_STATEMENTS_TABLE} (
  id, memory_type, field_path, category, status, sensitivity, label, strength, state,
  source_app_id, allowed_app_ids, allowed_actor_types,
  sensitive_payload, payload_iv, payload_tag, encryption_key_id,
  first_seen_at, last_seen_at, updated_at
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9,
  $10, $11::jsonb, $12::jsonb,
  $13, $14, $15, $16,
  $17, $18, NOW()
)
ON CONFLICT (id) DO UPDATE SET
  memory_type = EXCLUDED.memory_type,
  field_path = EXCLUDED.field_path,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  sensitivity = EXCLUDED.sensitivity,
  label = EXCLUDED.label,
  strength = EXCLUDED.strength,
  state = EXCLUDED.state,
  source_app_id = EXCLUDED.source_app_id,
  allowed_app_ids = EXCLUDED.allowed_app_ids,
  allowed_actor_types = EXCLUDED.allowed_actor_types,
  sensitive_payload = EXCLUDED.sensitive_payload,
  payload_iv = EXCLUDED.payload_iv,
  payload_tag = EXCLUDED.payload_tag,
  encryption_key_id = EXCLUDED.encryption_key_id,
  first_seen_at = EXCLUDED.first_seen_at,
  last_seen_at = EXCLUDED.last_seen_at,
  updated_at = NOW()
`;

export function createInMemoryStatementTable() {
  const rows = new Map();
  return {
    rows,
    async insert(row) {
      rows.set(row.id, row);
    },
    async findById(id) {
      return rows.get(id) || null;
    },
    async list() {
      return [...rows.values()];
    },
    async delete(id) {
      rows.delete(id);
    },
  };
}

export function createPostgresStatementStore({
  query,
  table = createInMemoryStatementTable(),
  env = process.env,
  key,
  keyId,
} = {}) {
  if (!query && !table) {
    throw new TypeError("Postgres statement store requires query() or an in-memory table.");
  }

  const resolvedKey = () => key || loadEncryptionKeyFromEnv(env);
  const resolvedKeyId = () => keyId || loadEncryptionKeyIdFromEnv(env);

  async function persistRow(encryptedRow) {
    if (query) {
      await query(UPSERT_SQL, [
        encryptedRow.id,
        encryptedRow.memory_type,
        encryptedRow.field_path,
        encryptedRow.category,
        encryptedRow.status,
        encryptedRow.sensitivity,
        encryptedRow.label,
        encryptedRow.strength,
        encryptedRow.state,
        encryptedRow.source_app_id,
        JSON.stringify(encryptedRow.allowed_app_ids || []),
        JSON.stringify(encryptedRow.allowed_actor_types || ["memact_worker"]),
        encryptedRow.sensitive_payload,
        encryptedRow.payload_iv,
        encryptedRow.payload_tag,
        encryptedRow.encryption_key_id,
        encryptedRow.first_seen_at,
        encryptedRow.last_seen_at,
      ]);
      return encryptedRow;
    }

    await table.insert(encryptedRow);
    return encryptedRow;
  }

  return {
    kind: query ? "postgres" : "postgres_in_memory",
    table,
    async upsert(memory) {
      const encryptedRow = encryptStatementRow(memory, {
        env,
        key: resolvedKey(),
        keyId: resolvedKeyId(),
      });
      await persistRow(encryptedRow);
      return decryptStatementRow(encryptedRow, { env, key: resolvedKey() });
    },
    async read(id) {
      const row = query
        ? (await query(`SELECT * FROM ${MEMORY_STATEMENTS_TABLE} WHERE id = $1`, [id])).rows?.[0]
        : await table.findById(id);
      return row ? decryptStatementRow(row, { env, key: resolvedKey() }) : null;
    },
    async list() {
      const rows = query
        ? (await query(`SELECT * FROM ${MEMORY_STATEMENTS_TABLE} ORDER BY updated_at DESC`)).rows || []
        : await table.list();
      return rows.map((row) => decryptStatementRow(row, { env, key: resolvedKey() }));
    },
    async delete(id) {
      if (query) {
        await query(`DELETE FROM ${MEMORY_STATEMENTS_TABLE} WHERE id = $1`, [id]);
        return;
      }
      await table.delete(id);
    },
    async readEncryptedRow(id) {
      return query
        ? (await query(`SELECT * FROM ${MEMORY_STATEMENTS_TABLE} WHERE id = $1`, [id])).rows?.[0] || null
        : table.findById(id);
    },
  };
}

export async function createPgQueryExecutor(connectionString, env = process.env) {
  const url = connectionString || env.MEMACT_MEMORY_DATABASE_URL || env.DATABASE_URL;
  if (!url) {
    throw new TypeError("PostgreSQL connection string is required.");
  }

  let pg;
  try {
    pg = await import("pg");
  } catch {
    throw new Error("PostgreSQL support requires the optional `pg` package.");
  }

  const pool = new pg.default.Pool({ connectionString: url });
  return {
    async query(text, params = []) {
      return pool.query(text, params);
    },
    async close() {
      await pool.end();
    },
  };
}
