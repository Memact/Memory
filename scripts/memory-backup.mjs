#!/usr/bin/env node
// Local backup and restore CLI for Memact memory stores.
//
// Usage:
//   memact-memory-backup backup  --store memory.json --out backup.json [--states active,approved]
//   memact-memory-backup restore --in backup.json --out restored.json
//
// Backups are written as AES-256-GCM encrypted JSON envelopes. The encryption
// key is read from the MEMACT_MEMORY_ENCRYPTION_KEY environment variable
// (32 bytes, base64 or 64-char hex); the key id from MEMACT_MEMORY_ENCRYPTION_KEY_ID.
import { readFile, writeFile } from "node:fs/promises";
import {
  decryptMemoryBackup,
  encryptMemoryBackup,
  MemoryBackupEnvelopeError,
  MemoryBackupValidationError,
} from "../src/backup-restore.mjs";
import {
  loadEncryptionKeyFromEnv,
  loadEncryptionKeyIdFromEnv,
} from "../src/field-encryption.mjs";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function usage() {
  console.error(
    [
      "Usage:",
      "  memact-memory-backup backup  --store memory.json --out backup.json [--states active,approved]",
      "  memact-memory-backup restore --in backup.json --out restored.json",
      "",
      "Environment:",
      "  MEMACT_MEMORY_ENCRYPTION_KEY     32-byte key as base64 or 64-char hex (required)",
      "  MEMACT_MEMORY_ENCRYPTION_KEY_ID  key identifier recorded in the envelope (optional)",
    ].join("\n"),
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function runBackup() {
  const storePath = argValue("--store");
  const outPath = argValue("--out");
  if (!storePath || !outPath) {
    usage();
    process.exit(1);
  }

  const statesArg = argValue("--states");
  const states = statesArg
    ? statesArg.split(",").map((state) => state.trim()).filter(Boolean)
    : undefined;

  const key = loadEncryptionKeyFromEnv();
  const keyId = loadEncryptionKeyIdFromEnv();
  const memoryStore = await readJson(storePath);
  const envelope = encryptMemoryBackup(memoryStore, { key, keyId, states });
  await writeFile(outPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  console.log(`Encrypted backup written to ${outPath} (${envelope.memory_count} approved memories).`);
}

async function runRestore() {
  const inPath = argValue("--in");
  const outPath = argValue("--out");
  if (!inPath || !outPath) {
    usage();
    process.exit(1);
  }

  const key = loadEncryptionKeyFromEnv();
  const envelope = await readJson(inPath);
  const restored = decryptMemoryBackup(envelope, key);
  await writeFile(outPath, `${JSON.stringify(restored, null, 2)}\n`, "utf8");
  console.log(`Restored ${restored.memories.length} memories to ${outPath}.`);
}

async function main() {
  const command = process.argv[2];
  try {
    if (command === "backup") {
      await runBackup();
    } else if (command === "restore") {
      await runRestore();
    } else {
      usage();
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof MemoryBackupValidationError) {
      console.error(`Backup validation failed: ${error.message}`);
      for (const detail of error.errors || []) {
        console.error(`  - ${detail.path || "(root)"}: ${detail.message}`);
      }
    } else if (error instanceof MemoryBackupEnvelopeError) {
      console.error(error.message);
    } else {
      console.error(error.message || String(error));
    }
    process.exit(1);
  }
}

main();
