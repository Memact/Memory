import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptUtf8,
  encryptUtf8,
  ENCRYPTION_KEY_ENV,
  loadEncryptionKeyFromEnv,
} from "../src/field-encryption.mjs";
import {
  createInMemoryStatementTable,
  createPostgresStatementStore,
  decryptStatementRow,
  encryptStatementRow,
  splitMemoryStatement,
} from "../src/postgres-statements.mjs";

const TEST_KEY = Buffer.alloc(32, 9);
const TEST_ENV = {
  [ENCRYPTION_KEY_ENV]: TEST_KEY.toString("base64"),
  MEMACT_MEMORY_ENCRYPTION_KEY_ID: "test-key",
};

const SENSITIVE_MEMORY = {
  id: "memory:field:diet-allergy",
  type: "field_memory",
  field_path: "diet.allergy",
  label: "Diet allergy",
  category: "fitness",
  status: "accepted",
  sensitivity: "sensitive",
  allowed_app_ids: ["nutriplan-lite"],
  allowed_actor_types: ["memact_worker"],
  summary: "User allergy statement",
  value: "peanuts",
  provenance: { system: "wiki", claim_type: "accepted_field" },
};

function rawRowContainsPlaintext(row, secret) {
  const parts = [row.sensitive_payload, row.payload_iv, row.payload_tag];
  const utf8Haystack = parts.map((part) => part.toString("utf8")).join("");
  const hexHaystack = parts.map((part) => part.toString("hex")).join("");
  return utf8Haystack.includes(secret) || hexHaystack.includes(secret);
}

test("splitMemoryStatement keeps metadata public and content sensitive", () => {
  const { publicRow, sensitivePayload } = splitMemoryStatement(SENSITIVE_MEMORY);
  assert.equal(publicRow.field_path, "diet.allergy");
  assert.equal(publicRow.sensitivity, "sensitive");
  assert.equal(sensitivePayload.value, "peanuts");
  assert.equal(sensitivePayload.summary, "User allergy statement");
  assert.equal(sensitivePayload.provenance.claim_type, "accepted_field");
});

test("AES-256-GCM roundtrip uses env key", () => {
  const encrypted = encryptUtf8("classified statement", { key: loadEncryptionKeyFromEnv(TEST_ENV), keyId: "test-key" });
  const decrypted = decryptUtf8(encrypted, loadEncryptionKeyFromEnv(TEST_ENV));
  assert.equal(decrypted, "classified statement");
});

test("encrypted statement rows do not store sensitive plaintext in table columns", async () => {
  const table = createInMemoryStatementTable();
  const store = createPostgresStatementStore({ table, env: TEST_ENV, key: TEST_KEY });

  await store.upsert(SENSITIVE_MEMORY);
  const encryptedRow = await store.readEncryptedRow(SENSITIVE_MEMORY.id);

  assert.ok(encryptedRow);
  assert.equal(encryptedRow.summary, undefined);
  assert.equal(encryptedRow.value, undefined);
  assert.ok(Buffer.isBuffer(encryptedRow.sensitive_payload));
  assert.ok(Buffer.isBuffer(encryptedRow.payload_iv));
  assert.ok(Buffer.isBuffer(encryptedRow.payload_tag));
  assert.equal(encryptedRow.encryption_key_id, "test-key");
  assert.equal(rawRowContainsPlaintext(encryptedRow, "peanuts"), false);
  assert.equal(rawRowContainsPlaintext(encryptedRow, "User allergy statement"), false);
});

test("statement store decrypts sensitive fields on read", async () => {
  const table = createInMemoryStatementTable();
  const store = createPostgresStatementStore({ table, env: TEST_ENV, key: TEST_KEY });

  await store.upsert(SENSITIVE_MEMORY);
  const memory = await store.read(SENSITIVE_MEMORY.id);

  assert.equal(memory.value, "peanuts");
  assert.equal(memory.summary, "User allergy statement");
  assert.equal(memory.field_path, "diet.allergy");
});

test("encryptStatementRow rejects missing env key", () => {
  assert.throws(
    () => encryptStatementRow(SENSITIVE_MEMORY, { env: {} }),
    /MEMACT_MEMORY_ENCRYPTION_KEY is required/,
  );
});

test("decrypt fails when ciphertext is tampered", () => {
  const encryptedRow = encryptStatementRow(SENSITIVE_MEMORY, { env: TEST_ENV, key: TEST_KEY });
  encryptedRow.sensitive_payload[0] ^= 0xff;
  assert.throws(() => decryptStatementRow(encryptedRow, { env: TEST_ENV, key: TEST_KEY }));
});

test("list returns decrypted memories while table stays encrypted", async () => {
  const table = createInMemoryStatementTable();
  const store = createPostgresStatementStore({ table, env: TEST_ENV, key: TEST_KEY });

  await store.upsert(SENSITIVE_MEMORY);
  const memories = await store.list();
  const encryptedRow = await store.readEncryptedRow(SENSITIVE_MEMORY.id);

  assert.equal(memories.length, 1);
  assert.equal(memories[0].value, "peanuts");
  assert.equal(rawRowContainsPlaintext(encryptedRow, "peanuts"), false);
});
