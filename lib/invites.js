// Pure helpers for single-use invite links.
//
// Kept free of database and network access so the token and expiry rules can be
// tested directly, matching lib/access.js and lib/environments.js.

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

import { INVITE_DURATIONS, DEFAULT_INVITE_HOURS } from "./inviteDurations.js";
export { INVITE_DURATIONS, DEFAULT_INVITE_HOURS };
const MAX_INVITE_HOURS = 168;

/**
 * Generate an invite token.
 *
 * 32 bytes from a CSPRNG, base64url encoded. Long enough that guessing is not a
 * consideration, and URL-safe so it survives being pasted into a chat client.
 */
export function generateInviteToken() {
  return randomBytes(32).toString("base64url");
}

/** Hash a token for storage or lookup. The plaintext is never persisted. */
export function hashInviteToken(token) {
  return createHash("sha256").update(String(token ?? ""), "utf8").digest("hex");
}

/**
 * Compare two hashes without leaking position through timing.
 *
 * Lookups are by unique index rather than by scanning, so this is belt and
 * braces — but a constant-time compare costs nothing and removes the question.
 */
export function hashesMatch(a, b) {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Validate a requested lifetime and turn it into an absolute expiry. */
export function resolveInviteExpiry(hours, now = Date.now()) {
  const n = Number(hours ?? DEFAULT_INVITE_HOURS);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_INVITE_HOURS) {
    return {
      ok: false,
      errors: [
        {
          field: "expiresInHours",
          message: `Choose a lifetime between 1 and ${MAX_INVITE_HOURS} hours.`,
        },
      ],
      value: null,
    };
  }
  return { ok: true, errors: [], value: new Date(now + n * 3_600_000) };
}

/**
 * Why an invite cannot be redeemed, or null if it can.
 *
 * Order matters: revoked is reported ahead of expired so someone told "that
 * invite was revoked" is not left thinking they merely arrived late.
 */
export function inviteRejectionReason(invite, now = Date.now()) {
  if (!invite) return "This invite link is not valid.";
  if (invite.revokedAt) return "This invite link was revoked.";
  if (invite.usedAt) return "This invite link has already been used.";
  if (new Date(invite.expiresAt).getTime() <= now) {
    return "This invite link has expired.";
  }
  return null;
}

/** Status for the settings list. */
export function inviteStatus(invite, now = Date.now()) {
  if (invite.revokedAt) return "revoked";
  if (invite.usedAt) return "used";
  if (new Date(invite.expiresAt).getTime() <= now) return "expired";
  return "active";
}
