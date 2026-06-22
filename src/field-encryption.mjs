import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const ENCRYPTION_ALGORITHM = "aes-256-gcm";
export const ENCRYPTION_KEY_ENV = "MEMACT_MEMORY_ENCRYPTION_KEY";
export const ENCRYPTION_KEY_ID_ENV = "MEMACT_MEMORY_ENCRYPTION_KEY_ID";
export const ENCRYPTION_KEY_BYTES = 32;
export const ENCRYPTION_IV_BYTES = 12;
export const ENCRYPTION_TAG_BYTES = 16;

function decodeKeyMaterial(value) {
  const text = String(value || "").trim();
  if (!text) {
    throw new TypeError(`${ENCRYPTION_KEY_ENV} is required.`);
  }

  const hex = text.startsWith("0x") ? text.slice(2) : text;
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length === ENCRYPTION_KEY_BYTES * 2) {
    return Buffer.from(hex, "hex");
  }

  const base64 = Buffer.from(text, "base64");
  if (base64.length === ENCRYPTION_KEY_BYTES) {
    return base64;
  }

  throw new TypeError(`${ENCRYPTION_KEY_ENV} must be 32 bytes as base64 or 64-char hex.`);
}

export function loadEncryptionKeyFromEnv(env = process.env) {
  return decodeKeyMaterial(env[ENCRYPTION_KEY_ENV]);
}

export function loadEncryptionKeyIdFromEnv(env = process.env) {
  return String(env[ENCRYPTION_KEY_ID_ENV] || "primary").trim() || "primary";
}

export function encryptBuffer(plaintext, { key, keyId = "primary", iv = randomBytes(ENCRYPTION_IV_BYTES) } = {}) {
  if (!key || key.length !== ENCRYPTION_KEY_BYTES) {
    throw new TypeError("AES-256-GCM requires a 32-byte key.");
  }

  const payload = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), "utf8");
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    algorithm: ENCRYPTION_ALGORITHM,
    key_id: keyId,
    iv,
    tag,
    ciphertext,
  };
}

export function decryptBuffer(encrypted, key) {
  const { ciphertext, iv, tag } = encrypted;
  if (!key || key.length !== ENCRYPTION_KEY_BYTES) {
    throw new TypeError("AES-256-GCM requires a 32-byte key.");
  }
  if (!Buffer.isBuffer(ciphertext) || !Buffer.isBuffer(iv) || !Buffer.isBuffer(tag)) {
    throw new TypeError("Encrypted payload requires ciphertext, iv, and tag buffers.");
  }

  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptUtf8(plaintext, options = {}) {
  const encrypted = encryptBuffer(plaintext, options);
  return {
    ...encrypted,
    plaintext_encoding: "utf8",
  };
}

export function decryptUtf8(encrypted, key) {
  return decryptBuffer(encrypted, key).toString("utf8");
}

export function encryptJson(value, options = {}) {
  return encryptUtf8(JSON.stringify(value ?? null), options);
}

export function decryptJson(encrypted, key) {
  return JSON.parse(decryptUtf8(encrypted, key));
}

export function bufferContainsUtf8(buffer, text) {
  if (!text) return false;
  return buffer.toString("utf8").includes(text);
}
