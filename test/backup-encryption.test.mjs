import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  APPROVED_MEMORY_STATES,
  BACKUP_ENVELOPE_FORMAT,
  decryptMemoryBackup,
  encryptMemoryBackup,
  MemoryBackupEnvelopeError,
  parseEncryptedBackupJson,
  serializeApprovedMemoryBackup,
} from "../src/backup-restore.mjs";

const KEY = randomBytes(32);

const STORE = {
  schema_version: "memact.memory.v0",
  memories: [
    {
      id: "memory:activity:approved",
      type: "activity_memory",
      label: "Approved memory",
      summary: "Kept in the backup",
      strength: 0.6,
      state: "approved",
      themes: ["keep"],
    },
    {
      id: "memory:activity:active",
      type: "activity_memory",
      label: "Active memory",
      summary: "Also kept",
      strength: 0.4,
      state: "active",
      themes: ["keep"],
    },
    {
      id: "memory:activity:forgotten",
      type: "activity_memory",
      label: "Forgotten memory",
      summary: "Should be excluded",
      strength: 0.1,
      state: "forgotten",
      themes: ["drop"],
    },
  ],
  relations: [
    {
      id: "relation:keep",
      from: "memory:activity:approved",
      to: "memory:activity:active",
      type: "supports",
    },
    {
      id: "relation:dangling",
      from: "memory:activity:approved",
      to: "memory:activity:forgotten",
      type: "supports",
    },
  ],
};

test("serializeApprovedMemoryBackup keeps only approved states", () => {
  const backup = serializeApprovedMemoryBackup(STORE);
  const ids = backup.memories.map((memory) => memory.id);
  assert.deepEqual(ids, ["memory:activity:approved", "memory:activity:active"]);
});

test("serializeApprovedMemoryBackup prunes relations to dropped memories", () => {
  const backup = serializeApprovedMemoryBackup(STORE);
  const relationIds = backup.relations.map((relation) => relation.id);
  assert.deepEqual(relationIds, ["relation:keep"]);
});

test("custom state filter restricts the export", () => {
  const backup = serializeApprovedMemoryBackup(STORE, { states: ["approved"] });
  assert.equal(backup.memories.length, 1);
  assert.equal(backup.memories[0].id, "memory:activity:approved");
});

test("default approved states exclude removed and pending entries", () => {
  assert.ok(!APPROVED_MEMORY_STATES.includes("forgotten"));
  assert.ok(!APPROVED_MEMORY_STATES.includes("superseded"));
  assert.ok(!APPROVED_MEMORY_STATES.includes("deleted"));
  assert.ok(!APPROVED_MEMORY_STATES.includes("pending"));
});

test("encrypt then decrypt round-trips approved memories", () => {
  const envelope = encryptMemoryBackup(STORE, { key: KEY, keyId: "test-key" });
  assert.equal(envelope.format, BACKUP_ENVELOPE_FORMAT);
  assert.equal(envelope.algorithm, "aes-256-gcm");
  assert.equal(envelope.key_id, "test-key");
  assert.equal(envelope.memory_count, 2);

  const restored = decryptMemoryBackup(envelope, KEY);
  assert.equal(restored.memories.length, 2);
  assert.ok(restored.graph);
  assert.ok(restored.stats);
});

test("ciphertext does not leak plaintext labels", () => {
  const envelope = encryptMemoryBackup(STORE, { key: KEY });
  const decoded = Buffer.from(envelope.ciphertext, "base64").toString("utf8");
  assert.ok(!decoded.includes("Approved memory"));
});

test("decrypt fails with a wrong key", () => {
  const envelope = encryptMemoryBackup(STORE, { key: KEY });
  assert.throws(
    () => decryptMemoryBackup(envelope, randomBytes(32)),
    (error) => {
      assert.ok(error instanceof MemoryBackupEnvelopeError);
      assert.match(error.message, /decryption failed/i);
      return true;
    },
  );
});

test("decrypt rejects an unsupported envelope format", () => {
  const envelope = encryptMemoryBackup(STORE, { key: KEY });
  assert.throws(
    () => decryptMemoryBackup({ ...envelope, format: "memact.memory.backup.v99" }, KEY),
    MemoryBackupEnvelopeError,
  );
});

test("decrypt rejects a tampered ciphertext", () => {
  const envelope = encryptMemoryBackup(STORE, { key: KEY });
  const bytes = Buffer.from(envelope.ciphertext, "base64");
  bytes[0] ^= 0xff;
  assert.throws(
    () => decryptMemoryBackup({ ...envelope, ciphertext: bytes.toString("base64") }, KEY),
    MemoryBackupEnvelopeError,
  );
});

test("parseEncryptedBackupJson restores from serialized envelope text", () => {
  const envelope = encryptMemoryBackup(STORE, { key: KEY });
  const restored = parseEncryptedBackupJson(JSON.stringify(envelope), KEY);
  assert.equal(restored.memories.length, 2);
});

test("parseEncryptedBackupJson rejects malformed envelope JSON", () => {
  assert.throws(
    () => parseEncryptedBackupJson("{not-json", KEY),
    MemoryBackupEnvelopeError,
  );
});
