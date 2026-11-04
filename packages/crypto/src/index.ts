import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

/** Parse a 32-byte master key given as 64 hex characters or base64. */
export function parseMasterKey(input: string): Buffer {
  const value = input.trim();
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(value)) key = Buffer.from(value, "hex");
  else key = Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      "Master key must be 32 bytes, given as 64 hex characters or base64. Generate one with: openssl rand -hex 32",
    );
  }
  return key;
}

/** Generate a fresh random 256-bit key (used as a per-project data key). */
export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

function seal(key: Buffer, plaintext: Buffer, aad: string): string {
  if (key.length !== KEY_BYTES) throw new Error("Key must be 32 bytes");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, nonce.toString("base64"), ct.toString("base64"), tag.toString("base64")].join(".");
}

function open(key: Buffer, sealed: string, aad: string): Buffer {
  if (key.length !== KEY_BYTES) throw new Error("Key must be 32 bytes");
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Unsupported ciphertext format");
  const nonce = Buffer.from(parts[1]!, "base64");
  const ct = Buffer.from(parts[2]!, "base64");
  const tag = Buffer.from(parts[3]!, "base64");
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error("Decryption failed: wrong key or tampered data");
  }
}

/** Wrap (encrypt) a data key with the master key. `context` binds it to e.g. a project id. */
export function wrapKey(masterKey: Buffer, dataKey: Buffer, context: string): string {
  return seal(masterKey, dataKey, `key:${context}`);
}

export function unwrapKey(masterKey: Buffer, wrapped: string, context: string): Buffer {
  return open(masterKey, wrapped, `key:${context}`);
}

/**
 * Encrypt one variable value. The associated data binds the ciphertext to its
 * location, so a ciphertext copied to another key or version fails to decrypt.
 */
export function encryptValue(dataKey: Buffer, value: string, context: string): string {
  return seal(dataKey, Buffer.from(value, "utf8"), `value:${context}`);
}

export function decryptValue(dataKey: Buffer, sealed: string, context: string): string {
  return open(dataKey, sealed, `value:${context}`).toString("utf8");
}

/** Re-wrap a data key under a new master key (master key rotation). */
export function rewrapKey(oldMaster: Buffer, newMaster: Buffer, wrapped: string, context: string): string {
  return wrapKey(newMaster, unwrapKey(oldMaster, wrapped, context), context);
}

/** Create an opaque API token: `prefix_<43 url-safe chars>`. */
export function generateToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/** Tokens are high-entropy, so a fast hash is appropriate for storage. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
export * from "./totp.js";
