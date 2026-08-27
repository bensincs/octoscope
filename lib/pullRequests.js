// Pure helpers for the cached pull-request view.
//
// Mirrors lib/access.js, lib/config.js and lib/environments.js: no database and
// no network, so the shaping rules can be unit-tested directly.

/** Milliseconds after which the cache is considered stale enough to nudge about. */
export const PR_STALE_AFTER_MS = 15 * 60 * 1000;

// PRs whose author was deleted still need somewhere to go.
const UNKNOWN_AUTHOR = "unknown";

/**
 * Group open pull requests by author, busiest person first.
 *
 * Ties break alphabetically so the order is stable between refreshes — a list
 * that reshuffles on every poll is much harder to read than a slightly
 * arbitrary but fixed one.
 *
 * Within an author, PRs are newest-updated first, matching what GitHub shows.
 */
export function groupByAuthor(rows = []) {
  const byLogin = new Map();

  for (const pr of rows) {
    const login = pr.authorLogin || UNKNOWN_AUTHOR;
    if (!byLogin.has(login)) {
      byLogin.set(login, {
        login,
        avatarUrl: pr.authorAvatarUrl ?? null,
        pullRequests: [],
        total: 0,
        drafts: 0,
        flagged: 0,
      });
    }
    const group = byLogin.get(login);
    // First non-null avatar wins; rows from a deleted account have none.
    if (!group.avatarUrl && pr.authorAvatarUrl) group.avatarUrl = pr.authorAvatarUrl;
    group.pullRequests.push(pr);
    group.total += 1;
    if (pr.isDraft) group.drafts += 1;
    if (pr.flags?.length) group.flagged += 1;
  }

  for (const group of byLogin.values()) {
    group.pullRequests.sort((a, b) => {
      const at = a.prUpdatedAt ? new Date(a.prUpdatedAt).getTime() : 0;
      const bt = b.prUpdatedAt ? new Date(b.prUpdatedAt).getTime() : 0;
      if (bt !== at) return bt - at;
      return a.number - b.number;
    });
  }

  return [...byLogin.values()].sort(
    (a, b) => b.total - a.total || a.login.localeCompare(b.login)
  );
}

/** Is a cache timestamp older than the staleness threshold? Never refreshed counts as stale. */
export function isStale(refreshedAt, now = Date.now()) {
  if (!refreshedAt) return true;
  const t = new Date(refreshedAt).getTime();
  if (Number.isNaN(t)) return true;
  return now - t > PR_STALE_AFTER_MS;
}

/**
 * Coarse relative time. Refreshes are minutes-to-hours apart, so second-level
 * precision would be noise.
 */
export function describeAge(refreshedAt, now = Date.now()) {
  if (!refreshedAt) return "never";
  const t = new Date(refreshedAt).getTime();
  if (Number.isNaN(t)) return "never";

  const secs = Math.max(0, (now - t) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Pull-request rulebook
// ---------------------------------------------------------------------------

/**
 * Flags a PR can carry. Each corresponds to a state that already blocks or
 * degrades a merge, so none of them are stylistic opinions.
 */
export const PR_FLAGS = {
  FAILING_CHECKS: "failing-checks",
  MERGE_CONFLICT: "merge-conflict",
  BEHIND_BASE: "behind-base",
};

export const PR_FLAG_LABELS = {
  [PR_FLAGS.FAILING_CHECKS]: "Failing checks",
  [PR_FLAGS.MERGE_CONFLICT]: "Merge conflict",
  [PR_FLAGS.BEHIND_BASE]: "Behind base",
};

const DEFAULT_PR_RULES = {
  flagFailingChecks: true,
  flagMergeConflicts: true,
  flagBehindBase: true,
};

/** Rules from a project config, with defaults for configs written before they existed. */
export function prRules(config) {
  return { ...DEFAULT_PR_RULES, ...(config?.pullRequests ?? {}) };
}

/**
 * Evaluate one pull request against the rules.
 *
 * UNKNOWN is never treated as healthy. GitHub computes `mergeable` and
 * `mergeStateStatus` lazily, so a PR it hasn't looked at recently reports
 * UNKNOWN — asserting "no conflict" from that would be a guess presented as a
 * fact. Unknown states are reported separately so the UI can say "not known
 * yet" instead of implying the PR is clean.
 */
export function evaluatePullRequest(pr, rules = DEFAULT_PR_RULES) {
  const flags = [];
  let unknownMergeState = false;

  // FAILURE and ERROR are genuine failures. PENDING is in-flight, not failing,
  // and a null rollup means the repo has no checks at all.
  if (rules.flagFailingChecks) {
    if (pr.checksState === "FAILURE" || pr.checksState === "ERROR") {
      flags.push(PR_FLAGS.FAILING_CHECKS);
    }
  }

  if (rules.flagMergeConflicts) {
    if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") {
      flags.push(PR_FLAGS.MERGE_CONFLICT);
    } else if (pr.mergeable === "UNKNOWN" || pr.mergeable == null) {
      unknownMergeState = true;
    }
  }

  if (rules.flagBehindBase && pr.mergeStateStatus === "BEHIND") {
    flags.push(PR_FLAGS.BEHIND_BASE);
  }

  return { flags, unknownMergeState };
}

/** Annotate a list of PRs with their flags, given a project config. */
export function annotatePullRequests(rows = [], config) {
  const rules = prRules(config);
  return rows.map((pr) => ({ ...pr, ...evaluatePullRequest(pr, rules) }));
}
