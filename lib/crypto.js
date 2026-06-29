import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/**
 * AES-256-GCM encryption for PATs at rest.
 *
 * The server key is read from PAT_ENCRYPTION_KEY (32 bytes, base64-encoded).
 * Payload format (base64 of):  [1-byte version][12-byte IV][16-byte auth tag][ciphertext]
 * stored/returned as a single base64 string. The version byte lets us rotate
 * the key/algorithm later without ambiguity.
 */

const ALGO = "aes-256-gcm";
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey = null;
let cachedRaw = null;

function getKey() {
  const raw = process.env.PAT_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "PAT_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32"
    );
  }
  // Memoize, but re-derive if the env value changes (e.g. in tests).
  if (cachedKey && cachedRaw === raw) return cachedKey;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `PAT_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Use: openssl rand -base64 32`
    );
  }
  cachedKey = key;
  cachedRaw = raw;
  return key;
}

/** Encrypt a plaintext string → base64 payload. */
export function encrypt(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encrypt() requires a non-empty string");
  }
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([
    Buffer.from([VERSION]),
    iv,
    tag,
    ciphertext,
  ]).toString("base64");
}

/** Decrypt a base64 payload produced by encrypt() → plaintext string. */
export function decrypt(payload) {
  if (typeof payload !== "string" || payload.length === 0) {
    throw new Error("decrypt() requires a non-empty string");
  }
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 1 + IV_LEN + TAG_LEN) {
    throw new Error("decrypt() payload is too short / malformed");
  }
  const version = buf[0];
  if (version !== VERSION) {
    throw new Error(`decrypt() unsupported payload version ${version}`);
  }
  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/** Mask a PAT for display, e.g. "ghp_…wXyZ". Never returns the full token. */
export function maskToken(token) {
  if (!token || typeof token !== "string") return "";
  if (token.length <= 8) return "…";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
