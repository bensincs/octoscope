// Pure helpers for Architecture Decision Records.
//
// Parsing lives here rather than in the GitHub client or the data layer so it
// can be unit-tested without a network or a database, matching lib/access.js,
// lib/config.js and lib/environments.js.

/** Markdown files only — ADR folders routinely also hold images and templates. */
export function isAdrFile(name) {
  return /\.mdx?$/i.test(String(name ?? ""));
}

/**
 * Derive a human title for an ADR.
 *
 * Prefers the first markdown H1, which is the convention in both the Nygard and
 * MADR templates. Falls back to prettifying the file name, so a file with no
 * heading still reads as something rather than as a path fragment.
 */
export function adrTitle(fileName, body) {
  const heading = String(body ?? "")
    .split(/\r?\n/)
    .find((line) => /^#\s+\S/.test(line));
  if (heading) return heading.replace(/^#\s+/, "").trim();
  return prettifyFileName(fileName);
}

/**
 * "0007-use-postgres.md" -> "0007 Use postgres".
 * Numeric prefixes are kept: they carry the ADR's identity and ordering.
 */
export function prettifyFileName(fileName) {
  const base = String(fileName ?? "").replace(/\.mdx?$/i, "");
  const words = base.replace(/[-_]+/g, " ").trim();
  // Capitalise the first LETTER, not the first character: ADR file names
  // usually start with a number, so charAt(0) would be a digit and the actual
  // word would stay lowercase ("0012 adopt drizzle").
  return words.replace(/[a-z]/, (c) => c.toUpperCase());
}

/**
 * Leading number in an ADR file name, or null.
 * Used for ordering, because "10" must not sort before "9".
 */
export function adrNumber(fileName) {
  const m = String(fileName ?? "").match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Sort ADRs by their numeric prefix, then by file name.
 *
 * Numbered records come first and in numeric order; anything unnumbered (a
 * README or template) sorts after, alphabetically. Stable regardless of the
 * order GitHub returns the tree in.
 */
export function sortAdrs(list = []) {
  return [...list].sort((a, b) => {
    const an = adrNumber(a.fileName);
    const bn = adrNumber(b.fileName);
    if (an !== null && bn !== null) return an - bn;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    return String(a.fileName).localeCompare(String(b.fileName));
  });
}

/** Normalise a user-entered folder path: no leading/trailing slashes. */
export function normalizeAdrPath(path) {
  return String(path ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}
