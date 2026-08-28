// Retention rules for GitHub-derived caches.
//
// Pure, like lib/access.js and lib/environments.js, so the age arithmetic can
// be tested without a database or a clock.

/** Offered retention periods. `null` means keep until replaced by a refresh. */
export const RETENTION_OPTIONS = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: null, label: "Until replaced" },
];

const MAX_RETENTION_DAYS = 3650;

/**
 * Validate a requested retention period.
 *
 * Zero is rejected rather than silently treated as "immediately": a policy that
 * deletes data the instant it is written is far more likely to be a mistake
 * than an intention, and the UI offers "Until replaced" for the other extreme.
 */
export function validateRetention(days) {
  if (days === null || days === undefined || days === "") {
    return { ok: true, errors: [], value: null };
  }
  const n = Number(days);
  if (!Number.isInteger(n) || n <= 0) {
    return {
      ok: false,
      errors: [{ field: "retentionDays", message: "Choose a valid retention period." }],
      value: null,
    };
  }
  if (n > MAX_RETENTION_DAYS) {
    return {
      ok: false,
      errors: [
        {
          field: "retentionDays",
          message: `Retention cannot exceed ${MAX_RETENTION_DAYS} days. Choose “Until replaced” instead.`,
        },
      ],
      value: null,
    };
  }
  return { ok: true, errors: [], value: n };
}

/** The instant before which data is considered expired, or null when unlimited. */
export function cutoffFor(retentionDays, now = Date.now()) {
  if (!retentionDays) return null;
  return new Date(now - retentionDays * 86_400_000);
}

/** Has a timestamp fallen outside the retention window? */
export function isExpired(timestamp, retentionDays, now = Date.now()) {
  const cutoff = cutoffFor(retentionDays, now);
  if (!cutoff || !timestamp) return false;
  const t = new Date(timestamp).getTime();
  if (Number.isNaN(t)) return false;
  return t < cutoff.getTime();
}

/** Human summary for the settings UI. */
export function describeRetention(retentionDays) {
  if (!retentionDays) return "kept until replaced by a refresh";
  if (retentionDays === 1) return "deleted after 1 day";
  return `deleted after ${retentionDays} days`;
}
