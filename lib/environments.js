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
