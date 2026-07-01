import { createHash } from "crypto";
import { reindexMemoryStore, MEMORY_SCHEMA_VERSION } from "./engine.mjs";
import { stripDerivedBackupFields, validateMemoryBackupShape } from "./memory-schemas.mjs";
import {
  ENCRYPTION_ALGORITHM,
  decryptUtf8,
  encryptUtf8,
} from "./field-encryption.mjs";

export { MEMORY_ENTITY_TYPES, VISIBLE_SCOPE_TYPES, stripDerivedBackupFields, validateMemoryBackupShape } from "./memory-schemas.mjs";

export const BACKUP_ENVELOPE_FORMAT = "memact.memory.backup.v1";

// States that count as user-approved for export. Forgotten, superseded,
// deleted, and still-pending entries are excluded from backups by default.
export const APPROVED_MEMORY_STATES = Object.freeze([
  "active",
  "accepted",
  "approved",
  "edited",
  "user_verified",
]);

export class MemoryBackupValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "MemoryBackupValidationError";
    this.errors = errors;
  }
}

export class MemoryBackupEnvelopeError extends Error {
  constructor(message) {
    super(message);
    this.name = "MemoryBackupEnvelopeError";
  }
}

export function serializeMemoryBackup(memoryStore = {}) {
  return stripDerivedBackupFields({
    schema_version: memoryStore.schema_version || MEMORY_SCHEMA_VERSION,
    generated_at: memoryStore.generated_at,
    source: memoryStore.source || {},
    thresholds: memoryStore.thresholds || {},
    memories: Array.isArray(memoryStore.memories) ? memoryStore.memories : [],
    relations: Array.isArray(memoryStore.relations) ? memoryStore.relations : [],
    actions: Array.isArray(memoryStore.actions) ? memoryStore.actions : [],
    graph_snapshots: Array.isArray(memoryStore.graph_snapshots) ? memoryStore.graph_snapshots : [],
  });
}

export function restoreMemoryFromBackup(backup = {}) {
  const result = validateMemoryBackupShape(stripDerivedBackupFields(backup));
  if (!result.ok) {
    throw new MemoryBackupValidationError("Memory backup failed structural verification", result.errors);
  }
  return reindexMemoryStore(result.value);
}

export function parseMemoryBackupJson(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new MemoryBackupValidationError("Invalid JSON backup", [{
      path: "",
      message: error.message,
    }]);
  }
  return restoreMemoryFromBackup(parsed);
}

function memoryState(memory = {}) {
  return memory.state || memory.status || "active";
}

// Serialize only approved memory entries, dropping relations and actions that
// would dangle once unapproved memories are excluded.
export function serializeApprovedMemoryBackup(memoryStore = {}, { states = APPROVED_MEMORY_STATES } = {}) {
  const approved = new Set(states);
  const serialized = serializeMemoryBackup(memoryStore);
  const memories = serialized.memories.filter((memory) => approved.has(memoryState(memory)));
  const keptIds = new Set(memories.map((memory) => memory.id));
  const refersToKept = (entry) =>
    (entry.from === undefined || keptIds.has(entry.from)) &&
    (entry.to === undefined || keptIds.has(entry.to)) &&
    (entry.target_id === undefined || keptIds.has(entry.target_id));

  return {
    ...serialized,
    memories,
    relations: serialized.relations.filter(refersToKept),
    actions: serialized.actions.filter(refersToKept),
  };
}

// Wrap a serialized backup in an AES-256-GCM encrypted JSON envelope.
export function encryptMemoryBackup(memoryStore = {}, { key, keyId = "primary", states, generatedAt = new Date().toISOString() } = {}) {
  const backup = serializeApprovedMemoryBackup(memoryStore, states ? { states } : {});
  const encrypted = encryptUtf8(JSON.stringify(backup), { key, keyId });
  return {
    format: BACKUP_ENVELOPE_FORMAT,
    algorithm: encrypted.algorithm,
    key_id: encrypted.key_id,
    created_at: generatedAt,
    memory_count: backup.memories.length,
    iv: encrypted.iv.toString("base64"),
    tag: encrypted.tag.toString("base64"),
    ciphertext: encrypted.ciphertext.toString("base64"),
  };
}

function decodeEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    throw new MemoryBackupEnvelopeError("Backup envelope must be an object.");
  }
  if (envelope.format !== BACKUP_ENVELOPE_FORMAT) {
    throw new MemoryBackupEnvelopeError(`Unsupported backup format: ${envelope.format ?? "missing"}.`);
  }
  if (envelope.algorithm !== ENCRYPTION_ALGORITHM) {
    throw new MemoryBackupEnvelopeError(`Unsupported backup algorithm: ${envelope.algorithm ?? "missing"}.`);
  }
  for (const field of ["iv", "tag", "ciphertext"]) {
    if (typeof envelope[field] !== "string" || !envelope[field]) {
      throw new MemoryBackupEnvelopeError(`Backup envelope is missing the ${field} field.`);
    }
  }
  return {
    algorithm: envelope.algorithm,
    key_id: envelope.key_id,
    iv: Buffer.from(envelope.iv, "base64"),
    tag: Buffer.from(envelope.tag, "base64"),
    ciphertext: Buffer.from(envelope.ciphertext, "base64"),
  };
}

// Decrypt an encrypted backup envelope and restore it into a memory store.
export function decryptMemoryBackup(envelope, key) {
  const encrypted = decodeEnvelope(envelope);
  let plaintext;
  try {
    plaintext = decryptUtf8(encrypted, key);
  } catch (error) {
    throw new MemoryBackupEnvelopeError(`Backup decryption failed: ${error.message}`);
  }
  return parseMemoryBackupJson(plaintext);
}

export function parseEncryptedBackupJson(jsonText, key) {
  let envelope;
  try {
    envelope = JSON.parse(jsonText);
  } catch (error) {
    throw new MemoryBackupEnvelopeError(`Invalid backup envelope JSON: ${error.message}`);
  }
  return decryptMemoryBackup(envelope, key);
}

/* ==========================================================================
   PARTIAL CONTEXT DATABASE UTILITIES (Issue #52 Implementation)
   ========================================================================== */

/**
 * Partial Context Database Export
 * Filters the memoryStore structures by a targeted namespace/category 
 * and outputs an export package containing a secure verification digest.
 */
export function exportPartialNamespace(memoryStore = {}, category) {
  if (!category) {
    throw new TypeError("Partial export requires a specific namespace (category) string.");
  }

  const baseBackup = serializeMemoryBackup(memoryStore);
  
  // Filter core entries by matching the targeted namespace/category
  const filteredMemories = baseBackup.memories.filter((m) => m.category === category);
  const internalIds = new Set(filteredMemories.map((m) => m.id));

  // Cleanly isolate intersecting relations/actions so we don't hold dangling graph records
  const contextualFilter = (item) => 
    (item.from === undefined || internalIds.has(item.from)) &&
    (item.to === undefined || internalIds.has(item.to)) &&
    (item.target_id === undefined || internalIds.has(item.target_id));

  const packagePayload = {
    version: "1.0",
    category,
    exported_at: new Date().toISOString(),
    schema_version: baseBackup.schema_version,
    data: {
      memories: filteredMemories,
      relations: baseBackup.relations.filter(contextualFilter),
      actions: baseBackup.actions.filter(contextualFilter)
    }
  };

  // Generate metadata digest for strict schema verification tracking
  const payloadString = JSON.stringify(packagePayload.data);
  const digest = createHash("sha256").update(payloadString).update(category).digest("hex");

  return {
    ...packagePayload,
    digest
  };
}

/**
 * Partial Context Database Import
 * Performs integrity digest verification on an export package before safely 
 * feeding the items into an existing runtime memory store.
 */
export function importPartialNamespace(currentMemoryStore = {}, exportPackage = {}) {
  const { category, data, digest } = exportPackage;

  if (!category || !data || !digest) {
    throw new MemoryBackupValidationError("Invalid partial context export package format.", []);
  }

  // Validate integrity metadata digest matches exactly
  const payloadString = JSON.stringify(data);
  const computedDigest = createHash("sha256").update(payloadString).update(category).digest("hex");

  if (digest !== computedDigest) {
    throw new MemoryBackupValidationError("Integrity check failed: Partial package digest mismatch.", []);
  }

  // Map out and initialize empty arrays if current data stores aren't set up yet
  const targetStore = {
    ...currentMemoryStore,
    memories: Array.isArray(currentMemoryStore.memories) ? [...currentMemoryStore.memories] : [],
    relations: Array.isArray(currentMemoryStore.relations) ? [...currentMemoryStore.relations] : [],
    actions: Array.isArray(currentMemoryStore.actions) ? [...currentMemoryStore.actions] : [],
  };

  // Upsert records (overwrite existing IDs, add new ones)
  const existingMemoryIds = new Map(targetStore.memories.map((m, idx) => [m.id, idx]));
  for (const newMemory of (data.memories || [])) {
    if (existingMemoryIds.has(newMemory.id)) {
      targetStore.memories[existingMemoryIds.get(newMemory.id)] = newMemory;
    } else {
      targetStore.memories.push(newMemory);
    }
  }

  // Safety append for relational context structures
  if (Array.isArray(data.relations)) targetStore.relations.push(...data.relations);
  if (Array.isArray(data.actions)) targetStore.actions.push(...data.actions);

  // Return the newly indexed memory engine matrix state
  return reindexMemoryStore(targetStore);
}