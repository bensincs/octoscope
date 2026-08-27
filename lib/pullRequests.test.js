import { describe, it, expect } from "vitest";
import {
  groupByAuthor,
  isStale,
  describeAge,
  evaluatePullRequest,
  annotatePullRequests,
  prRules,
  PR_FLAGS,
  PR_STALE_AFTER_MS,
} from "@/lib/pullRequests";

const pr = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  number: 1,
  title: "t",
  url: "u",
  authorLogin: "alice",
  authorAvatarUrl: "a.png",
  isDraft: false,
  prUpdatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("groupByAuthor", () => {
  it("groups by author and counts", () => {
    const groups = groupByAuthor([
      pr({ authorLogin: "alice", number: 1 }),
      pr({ authorLogin: "bob", number: 2 }),
      pr({ authorLogin: "alice", number: 3 }),
    ]);
    expect(groups.map((g) => [g.login, g.total])).toEqual([
      ["alice", 2],
      ["bob", 1],
    ]);
  });

  it("counts drafts separately without excluding them", () => {
    const groups = groupByAuthor([
      pr({ authorLogin: "alice", number: 1, isDraft: true }),
      pr({ authorLogin: "alice", number: 2 }),
    ]);
    expect(groups[0].total).toBe(2);
    expect(groups[0].drafts).toBe(1);
  });

  it("orders busiest first", () => {
    const groups = groupByAuthor([
      pr({ authorLogin: "solo", number: 1 }),
      pr({ authorLogin: "busy", number: 2 }),
      pr({ authorLogin: "busy", number: 3 }),
    ]);
    expect(groups[0].login).toBe("busy");
  });

  // A list that reshuffles between identical refreshes is hard to read.
  it("breaks ties alphabetically so ordering is stable", () => {
    const groups = groupByAuthor([
      pr({ authorLogin: "zoe", number: 1 }),
      pr({ authorLogin: "adam", number: 2 }),
      pr({ authorLogin: "mia", number: 3 }),
    ]);
    expect(groups.map((g) => g.login)).toEqual(["adam", "mia", "zoe"]);
  });

  it("sorts each author's PRs newest-updated first", () => {
    const groups = groupByAuthor([
      pr({ number: 1, prUpdatedAt: "2026-01-01T00:00:00Z" }),
      pr({ number: 2, prUpdatedAt: "2026-03-01T00:00:00Z" }),
      pr({ number: 3, prUpdatedAt: "2026-02-01T00:00:00Z" }),
    ]);
    expect(groups[0].pullRequests.map((p) => p.number)).toEqual([2, 3, 1]);
  });

  // PRs from deleted GitHub accounts have a null author.
  it("buckets authorless PRs under 'unknown'", () => {
    const groups = groupByAuthor([
      pr({ authorLogin: null, authorAvatarUrl: null, number: 9 }),
    ]);
    expect(groups[0].login).toBe("unknown");
    expect(groups[0].avatarUrl).toBeNull();
  });

  it("recovers an avatar from any row that has one", () => {
    const groups = groupByAuthor([
      pr({ authorLogin: "alice", authorAvatarUrl: null, number: 1 }),
      pr({ authorLogin: "alice", authorAvatarUrl: "found.png", number: 2 }),
    ]);
    expect(groups[0].avatarUrl).toBe("found.png");
  });

  it("handles an empty list", () => {
    expect(groupByAuthor([])).toEqual([]);
    expect(groupByAuthor()).toEqual([]);
  });
});

describe("isStale", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it("treats never-refreshed as stale", () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale(undefined, now)).toBe(true);
  });

  it("treats an unparseable timestamp as stale", () => {
    expect(isStale("not a date", now)).toBe(true);
  });

  it("is fresh just inside the threshold", () => {
    expect(isStale(new Date(now - PR_STALE_AFTER_MS + 1000), now)).toBe(false);
  });

  it("is stale just outside the threshold", () => {
    expect(isStale(new Date(now - PR_STALE_AFTER_MS - 1000), now)).toBe(true);
  });
});

describe("describeAge", () => {
  const now = Date.UTC(2026, 0, 2, 12, 0, 0);
  const ago = (ms) => new Date(now - ms).toISOString();

  it("describes never", () => {
    expect(describeAge(null, now)).toBe("never");
    expect(describeAge("nonsense", now)).toBe("never");
  });

  it("describes recent times", () => {
    expect(describeAge(ago(5_000), now)).toBe("just now");
    expect(describeAge(ago(5 * 60_000), now)).toBe("5m ago");
    expect(describeAge(ago(3 * 3_600_000), now)).toBe("3h ago");
    expect(describeAge(ago(24 * 3_600_000), now)).toBe("yesterday");
    expect(describeAge(ago(3 * 86_400_000), now)).toBe("3d ago");
  });
});

describe("evaluatePullRequest", () => {
  const rules = {
    flagFailingChecks: true,
    flagMergeConflicts: true,
    flagBehindBase: true,
  };
  const clean = {
    checksState: "SUCCESS",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
  };

  it("flags nothing on a healthy PR", () => {
    expect(evaluatePullRequest(clean, rules)).toEqual({
      flags: [],
      unknownMergeState: false,
    });
  });

  it("flags failing and errored checks", () => {
    expect(
      evaluatePullRequest({ ...clean, checksState: "FAILURE" }, rules).flags
    ).toContain(PR_FLAGS.FAILING_CHECKS);
    expect(
      evaluatePullRequest({ ...clean, checksState: "ERROR" }, rules).flags
    ).toContain(PR_FLAGS.FAILING_CHECKS);
  });

  // Pending checks are in flight, not failing; a null rollup means no CI at all.
  it("does not flag pending or absent checks", () => {
    expect(
      evaluatePullRequest({ ...clean, checksState: "PENDING" }, rules).flags
    ).toEqual([]);
    expect(
      evaluatePullRequest({ ...clean, checksState: null }, rules).flags
    ).toEqual([]);
  });

  it("flags merge conflicts from either signal", () => {
    expect(
      evaluatePullRequest({ ...clean, mergeable: "CONFLICTING" }, rules).flags
    ).toContain(PR_FLAGS.MERGE_CONFLICT);
    expect(
      evaluatePullRequest({ ...clean, mergeStateStatus: "DIRTY" }, rules).flags
    ).toContain(PR_FLAGS.MERGE_CONFLICT);
  });

  it("flags a PR behind its base", () => {
    expect(
      evaluatePullRequest({ ...clean, mergeStateStatus: "BEHIND" }, rules).flags
    ).toContain(PR_FLAGS.BEHIND_BASE);
  });

  // GitHub computes merge state lazily. Claiming "no conflict" from UNKNOWN
  // would be a guess presented as fact.
  it("reports unknown merge state instead of assuming clean", () => {
    const r = evaluatePullRequest({ ...clean, mergeable: "UNKNOWN" }, rules);
    expect(r.flags).toEqual([]);
    expect(r.unknownMergeState).toBe(true);
  });

  it("respects disabled rules", () => {
    const off = {
      flagFailingChecks: false,
      flagMergeConflicts: false,
      flagBehindBase: false,
    };
    const bad = {
      checksState: "FAILURE",
      mergeable: "CONFLICTING",
      mergeStateStatus: "BEHIND",
    };
    expect(evaluatePullRequest(bad, off).flags).toEqual([]);
  });

  it("can flag several problems at once", () => {
    const r = evaluatePullRequest(
      { checksState: "FAILURE", mergeable: "MERGEABLE", mergeStateStatus: "BEHIND" },
      rules
    );
    expect(r.flags).toHaveLength(2);
  });
});

describe("prRules", () => {
  // Configs written before PR rules existed must still work.
  it("defaults every flag on when absent", () => {
    expect(prRules(undefined)).toEqual({
      flagFailingChecks: true,
      flagMergeConflicts: true,
      flagBehindBase: true,
    });
    expect(prRules({})).toEqual(prRules(undefined));
  });

  it("lets a config override individual flags", () => {
    expect(prRules({ pullRequests: { flagBehindBase: false } })).toEqual({
      flagFailingChecks: true,
      flagMergeConflicts: true,
      flagBehindBase: false,
    });
  });
});

describe("annotatePullRequests + grouping", () => {
  it("counts flagged PRs per author", () => {
    const rows = annotatePullRequests(
      [
        { authorLogin: "alice", number: 1, checksState: "FAILURE" },
        { authorLogin: "alice", number: 2, checksState: "SUCCESS", mergeable: "MERGEABLE" },
      ],
      {}
    );
    const [group] = groupByAuthor(rows);
    expect(group.total).toBe(2);
    expect(group.flagged).toBe(1);
  });
});
