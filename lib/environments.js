// Pure helpers for claimable project environments.
//
// Mirrors lib/access.js and lib/config.js: no database access, so the rules can
// be unit-tested in isolation and the data layer stays a thin persistence
// wrapper around them.

// Bounds on free-text fields, enforced server-side so a client can't post a
// multi-megabyte body straight into the database.
export const ENV_NAME_MAX_LENGTH = 60;
export const ENV_DESCRIPTION_MAX_LENGTH = 500;
export const CLAIM_NOTE_MAX_LENGTH = 280;
export const WELCOME_MAX_LENGTH = 50_000;

const clean = (s) => String(s ?? "").trim();
const lower = (s) => clean(s).toLowerCase();

/**
 * Validate a new or edited environment.
 *
 * Pass only the keys being changed; `undefined` means "leave alone", which is
 * what makes this usable for both create and partial update. Returns
 * `{ ok, errors, value }` where `value` holds only the normalised keys that
 * were actually supplied.
 */
export function validateEnvironment({ name, description } = {}) {
  const errors = [];
  const value = {};

  if (name !== undefined) {
    const n = clean(name);
    if (!n) {
      errors.push({ field: "name", message: "Environment name is required." });
    } else if (n.length > ENV_NAME_MAX_LENGTH) {
      errors.push({
        field: "name",
        message: `Name must be ${ENV_NAME_MAX_LENGTH} characters or fewer.`,
      });
    } else {
      value.name = n;
    }
  }

  if (description !== undefined) {
    const d = clean(description);
    if (d.length > ENV_DESCRIPTION_MAX_LENGTH) {
      errors.push({
        field: "description",
        message: `Description must be ${ENV_DESCRIPTION_MAX_LENGTH} characters or fewer.`,
      });
    } else {
      // Empty string clears the description.
      value.description = d || null;
    }
  }

  return { ok: errors.length === 0, errors, value };
}

/**
 * Find an existing environment whose name collides with `name`, ignoring case.
 *
 * The unique index only catches exact duplicates, but "Staging" and "staging"
 * are the same environment to a human. Pass `excludeId` when renaming so an
 * environment doesn't collide with itself.
 */
export function findNameClash(existing, name, excludeId = null) {
  const target = lower(name);
  if (!target) return null;
  return (
    existing.find((e) => lower(e.name) === target && e.id !== excludeId) ?? null
  );
}

/** Validate a claim note. Returns `{ ok, errors, value }`; value is null when blank. */
export function validateClaimNote(note) {
  const n = clean(note);
  if (n.length > CLAIM_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      errors: [
        {
          field: "note",
          message: `Note must be ${CLAIM_NOTE_MAX_LENGTH} characters or fewer.`,
        },
      ],
      value: null,
    };
  }
  return { ok: true, errors: [], value: n || null };
}

/**
 * May `userId` (holding `role`) release this claim?
 *
 * The holder can always release their own. Anyone else needs admin, so a
 * forgotten claim can be cleared without waiting for its owner. An unclaimed
 * environment is trivially releasable — release is idempotent.
 */
export function canRelease({ claim, userId, role }, meetsRoleFn) {
  if (!claim) return true;
  if (claim.userId && userId && claim.userId === userId) return true;
  return meetsRoleFn(role, "admin");
}

/** Validate welcome-page markdown. Returns `{ ok, errors, value }`; blank → null. */
export function validateWelcome(markdown) {
  const body = clean(markdown);
  if (body.length > WELCOME_MAX_LENGTH) {
    return {
      ok: false,
      errors: [
        {
          field: "welcomeMarkdown",
          message: `Welcome page must be ${WELCOME_MAX_LENGTH} characters or fewer.`,
        },
      ],
      value: null,
    };
  }
  // Empty clears the page, which hides the Welcome tab again.
  return { ok: true, errors: [], value: body || null };
}

// ---------------------------------------------------------------------------
// Claim expiry
// ---------------------------------------------------------------------------

/**
 * Offered claim durations, in hours. `null` means no expiry.
 *
 * Deliberately a fixed list rather than free input: the point is a quick
 * decision at claim time, and an arbitrary-minutes field invites people to skip
 * past it.
 */
export const CLAIM_DURATIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 4, label: "4 hours" },
  { hours: 8, label: "8 hours" },
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
  { hours: null, label: "No expiry" },
];

/** A working day: long enough for most work, short enough to self-clear overnight. */
export const DEFAULT_CLAIM_HOURS = 8;

const MAX_CLAIM_HOURS = 168;

/**
 * Validate a requested duration and turn it into an absolute expiry.
 *
 * Stored as an instant rather than a duration so expiry doesn't depend on when
 * it's read, and so extending is just writing a later timestamp.
 */
export function resolveClaimExpiry(hours, now = Date.now()) {
  if (hours === null || hours === undefined || hours === "") {
    return { ok: true, errors: [], value: null };
  }
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) {
    return {
      ok: false,
      errors: [{ field: "expiresInHours", message: "Choose a valid duration." }],
      value: null,
    };
  }
  if (n > MAX_CLAIM_HOURS) {
    return {
      ok: false,
      errors: [
        {
          field: "expiresInHours",
          message: `Claims can last at most ${MAX_CLAIM_HOURS} hours. Choose “No expiry” instead.`,
        },
      ],
      value: null,
    };
  }
  return { ok: true, errors: [], value: new Date(now + n * 3_600_000) };
}

/** Has a claim lapsed? A claim with no expiry never has; no claim is trivially expired. */
export function isClaimExpired(claim, now = Date.now()) {
  if (!claim) return true;
  if (!claim.expiresAt) return false;
  const t = new Date(claim.expiresAt).getTime();
  if (Number.isNaN(t)) return false;
  return t <= now;
}

/**
 * Human description of time remaining, e.g. "3h left", "12m left".
 * Returns null for a claim that never expires.
 */
export function describeRemaining(expiresAt, now = Date.now()) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "expired";

  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m left`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h left`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "1 day left" : `${days} days left`;
}
