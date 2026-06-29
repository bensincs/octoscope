// Audit-project configuration: shape, defaults, and strict validation.
//
// `compileConfig` (in hierarchy.js) is deliberately lenient so rendering never
// crashes on odd data. This module is the STRICT gate used at the API boundary
// before a config is written to the database — it returns field-level errors so
// the user gets actionable feedback instead of a silently-defaulted config.

/**
 * @typedef {Object} AuditConfig
 * @property {string[][]} levels        Ordered container chain, top→bottom.
 *                                      Each entry lists the type names at that depth,
 *                                      e.g. [["Epic"],["Feature"],["User Story"],["Task","Bug"]].
 * @property {Record<string,string>} [aliases]  Incoming type name → canonical label.
 * @property {Record<string,string>} [accents]  Type label → hex colour override.
 * @property {string[]} [allowedLabels] Labels permitted when enforceLabels is on.
 * @property {boolean} [enforceLabels]  Flag labels outside allowedLabels.
 */

const MAX_LEVELS = 8;
const MAX_TYPES_PER_LEVEL = 12;
const MAX_LABELS = 200;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate a raw config object.
 * @returns {{ ok: boolean, errors: string[], value: AuditConfig | null }}
 */
export function validateConfig(raw) {
  const errors = [];

  if (!isPlainObject(raw)) {
    return { ok: false, errors: ["Config must be an object."], value: null };
  }

  // ---- levels (required) ----
  const levels = raw.levels;
  if (!Array.isArray(levels) || levels.length === 0) {
    errors.push("`levels` must be a non-empty array.");
  } else if (levels.length > MAX_LEVELS) {
    errors.push(`\`levels\` may have at most ${MAX_LEVELS} levels.`);
  } else {
    const seen = new Set();
    levels.forEach((lvl, i) => {
      if (!Array.isArray(lvl) || lvl.length === 0) {
        errors.push(`Level ${i + 1} must be a non-empty array of type names.`);
        return;
      }
      if (lvl.length > MAX_TYPES_PER_LEVEL) {
        errors.push(`Level ${i + 1} has too many types (max ${MAX_TYPES_PER_LEVEL}).`);
      }
      lvl.forEach((name) => {
        if (typeof name !== "string" || name.trim() === "") {
          errors.push(`Level ${i + 1} contains an empty type name.`);
          return;
        }
        const key = name.trim().toLowerCase();
        if (seen.has(key)) {
          errors.push(`Type "${name.trim()}" appears in more than one level.`);
        }
        seen.add(key);
      });
    });
  }

  // ---- aliases (optional) ----
  if (raw.aliases !== undefined) {
    if (!isPlainObject(raw.aliases)) {
      errors.push("`aliases` must be an object mapping alias → type name.");
    } else {
      for (const [k, v] of Object.entries(raw.aliases)) {
        if (typeof v !== "string" || v.trim() === "") {
          errors.push(`Alias "${k}" must point to a non-empty type name.`);
        }
      }
    }
  }

  // ---- accents (optional) ----
  if (raw.accents !== undefined) {
    if (!isPlainObject(raw.accents)) {
      errors.push("`accents` must be an object mapping type → hex colour.");
    } else {
      for (const [k, v] of Object.entries(raw.accents)) {
        if (typeof v !== "string" || !HEX_RE.test(v)) {
          errors.push(`Accent for "${k}" must be a hex colour like #60a5fa.`);
        }
      }
    }
  }

  // ---- allowedLabels (optional) ----
  if (raw.allowedLabels !== undefined) {
    if (!Array.isArray(raw.allowedLabels)) {
      errors.push("`allowedLabels` must be an array of strings.");
    } else if (raw.allowedLabels.length > MAX_LABELS) {
      errors.push(`\`allowedLabels\` may have at most ${MAX_LABELS} entries.`);
    } else if (raw.allowedLabels.some((l) => typeof l !== "string")) {
      errors.push("`allowedLabels` must contain only strings.");
    }
  }

  // ---- enforceLabels (optional) ----
  if (raw.enforceLabels !== undefined && typeof raw.enforceLabels !== "boolean") {
    errors.push("`enforceLabels` must be a boolean.");
  }
  if (
    raw.enforceLabels === true &&
    (!Array.isArray(raw.allowedLabels) || raw.allowedLabels.length === 0)
  ) {
    errors.push("`enforceLabels` is on but `allowedLabels` is empty.");
  }

  if (errors.length) return { ok: false, errors, value: null };

  // Build the cleaned, canonical value (trim everything).
  const value = {
    levels: raw.levels.map((lvl) => lvl.map((t) => t.trim())),
    aliases: raw.aliases
      ? Object.fromEntries(
          Object.entries(raw.aliases).map(([k, v]) => [k.trim(), v.trim()])
        )
      : {},
    allowedLabels: (raw.allowedLabels || []).map((l) => l.trim()).filter(Boolean),
    enforceLabels: !!raw.enforceLabels,
  };
  if (raw.accents) value.accents = { ...raw.accents };

  return { ok: true, errors: [], value };
}
