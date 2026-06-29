import { describe, it, expect, beforeAll } from "vitest";

// 32-byte base64 key for tests (do NOT use in production).
beforeAll(() => {
  process.env.PAT_ENCRYPTION_KEY =
    process.env.PAT_ENCRYPTION_KEY ||
    "jeS/h2Ku9+GkW5qP859cB3awAa3oILepJIqfhRbK8xY=";
});

const { encrypt, decrypt, maskToken } = await import("./crypto.js");

describe("crypto (AES-256-GCM PAT-at-rest)", () => {
  it("round-trips a token", () => {
    const tok = "ghp_AbCdEf0123456789XyZwVuTs";
    expect(decrypt(encrypt(tok))).toBe(tok);
  });

  it("uses a random IV (ciphertext differs each call)", () => {
    const tok = "ghp_same_input_value";
    expect(encrypt(tok)).not.toBe(encrypt(tok));
  });

  it("detects tampering via the auth tag", () => {
    const enc = encrypt("ghp_tamper_me");
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 1;
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });

  it("rejects empty input", () => {
    expect(() => encrypt("")).toThrow();
    expect(() => decrypt("")).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decrypt("not-real-ciphertext")).toThrow();
  });

  it("masks a token without revealing it", () => {
    expect(maskToken("ghp_AbCdEf0123456789XyZwVuTs")).toBe("ghp_…VuTs");
    expect(maskToken("short")).toBe("…");
    expect(maskToken("")).toBe("");
  });

  it("fails to decrypt when the key changes (rotation guard)", () => {
    const original = process.env.PAT_ENCRYPTION_KEY;
    const enc = encrypt("ghp_secret");
    // Swap to a different valid 32-byte key, then restore.
    process.env.PAT_ENCRYPTION_KEY =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    try {
      expect(() => decrypt(enc)).toThrow();
    } finally {
      process.env.PAT_ENCRYPTION_KEY = original;
    }
    // Restored key still works.
    expect(decrypt(enc)).toBe("ghp_secret");
  });

  it("rejects an unknown payload version", () => {
    const enc = encrypt("ghp_versioned");
    const buf = Buffer.from(enc, "base64");
    buf[0] = 9; // bogus version
    expect(() => decrypt(buf.toString("base64"))).toThrow(/version/);
  });
});
