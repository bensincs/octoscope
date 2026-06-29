import { describe, it, expect } from "vitest";
import { buildTree, compileConfig, DEFAULT_CONFIG } from "@/lib/hierarchy";

// Minimal issue factory with sensible defaults.
function mk(over) {
  return {
    id: over.id || `i${over.number}`,
    number: over.number,
    title: over.title || `Issue ${over.number}`,
    url: `https://example/${over.number}`,
    state: "OPEN",
    type: null,
    parentId: null,
    parentNumber: null,
    parentType: null,
    subIssueCount: 0,
    assignees: [],
    ...over,
  };
}

function codesFor(issues, number) {
  const { byId } = buildTree(issues);
  const node = [...byId.values()].find((n) => n.number === number);
  return node.problems.map((p) => p.code);
}

// A typed container that wouldn't otherwise trip emptyContainer/orphan.
const happyEpic = (over = {}) =>
  mk({ number: 1, type: "Epic", subIssueCount: 1, ...over });
const happyFeature = (over = {}) =>
  mk({
    number: 2,
    type: "Feature",
    parentId: "i1",
    parentNumber: 1,
    parentType: "Epic",
    subIssueCount: 1,
    assignees: [{ login: "a", avatarUrl: "" }],
    ...over,
  });

describe("hierarchy / typing rules", () => {
  it("flags an untyped issue", () => {
    expect(codesFor([mk({ number: 1 })], 1)).toContain("untyped");
  });

  it("flags an unknown type", () => {
    expect(codesFor([mk({ number: 1, type: "Spike" })], 1)).toContain(
      "unknownType"
    );
  });

  it("flags an Epic that has a parent", () => {
    const issues = [
      mk({ number: 1, type: "Epic", subIssueCount: 1, parentId: "x", parentType: "Epic" }),
    ];
    expect(codesFor(issues, 1)).toContain("epicHasParent");
  });

  it("flags an orphan (non-epic with no parent)", () => {
    expect(codesFor([mk({ number: 1, type: "Feature", subIssueCount: 1 })], 1)).toContain(
      "orphan"
    );
  });

  it("flags a wrong-parent relationship", () => {
    // A Task (level 3) whose parent is an Epic (level 0) — should be a Story.
    const issues = [
      mk({
        number: 5,
        type: "Task",
        parentId: "i1",
        parentNumber: 1,
        parentType: "Epic",
      }),
    ];
    expect(codesFor(issues, 5)).toContain("wrongParent");
  });

  it("flags a parent with no type", () => {
    const issues = [
      mk({ number: 3, type: "User Story", parentId: "i9", parentNumber: 9 }),
    ];
    expect(codesFor(issues, 3)).toContain("parentUntyped");
  });

  it("warns on an empty container", () => {
    expect(codesFor([happyEpic({ subIssueCount: 0 })], 1)).toContain(
      "emptyContainer"
    );
  });

  it("treats Bug as a valid leaf under a User Story", () => {
    const issues = [
      mk({
        number: 7,
        type: "Bug",
        parentId: "i3",
        parentNumber: 3,
        parentType: "User Story",
      }),
    ];
    expect(codesFor(issues, 7)).toEqual([]);
  });

  it("produces a clean Epic > Feature chain", () => {
    expect(codesFor([happyEpic(), happyFeature()], 2)).toEqual([]);
  });
});

describe("sprint rules", () => {
  const sprint = (state) => ({ name: "S1", state });

  it("flags an Epic placed in a sprint (containerInSprint)", () => {
    expect(codesFor([happyEpic({ sprint: sprint("current") })], 1)).toContain(
      "containerInSprint"
    );
  });

  it("flags a Feature placed in a sprint (containerInSprint)", () => {
    expect(codesFor([happyFeature({ sprint: sprint("current") })], 2)).toContain(
      "containerInSprint"
    );
  });

  it("does NOT flag a User Story placed in a sprint", () => {
    const issues = [
      mk({
        number: 3,
        type: "User Story",
        parentId: "i2",
        parentNumber: 2,
        parentType: "Feature",
        subIssueCount: 1,
        sprint: sprint("current"),
      }),
    ];
    expect(codesFor(issues, 3)).not.toContain("containerInSprint");
  });

  it("flags in-progress work parked in a finished sprint", () => {
    const issues = [
      mk({
        number: 5,
        type: "Task",
        parentId: "i3",
        parentNumber: 3,
        parentType: "User Story",
        status: "In Progress",
        sprint: sprint("past"),
      }),
    ];
    expect(codesFor(issues, 5)).toContain("inProgressPastSprint");
  });
});

describe("status / state rules", () => {
  it("flags closed-but-not-done", () => {
    const issues = [
      mk({
        number: 5,
        type: "Task",
        parentId: "i3",
        parentNumber: 3,
        parentType: "User Story",
        state: "CLOSED",
        status: "In Progress",
      }),
    ];
    expect(codesFor(issues, 5)).toContain("closedNotDone");
  });

  it("flags open-but-done", () => {
    const issues = [
      mk({
        number: 5,
        type: "Task",
        parentId: "i3",
        parentNumber: 3,
        parentType: "User Story",
        state: "OPEN",
        status: "Done",
      }),
    ];
    expect(codesFor(issues, 5)).toContain("openButDone");
  });
});

describe("project rules", () => {
  it("flags an open issue missing from the board", () => {
    const issues = [
      mk({
        number: 5,
        type: "Task",
        parentId: "i3",
        parentNumber: 3,
        parentType: "User Story",
        projectActive: true,
        inProject: false,
      }),
    ];
    expect(codesFor(issues, 5)).toContain("missingFromProject");
  });

  it("flags a board item with no status", () => {
    const issues = [
      mk({
        number: 5,
        type: "Task",
        parentId: "i3",
        parentNumber: 3,
        parentType: "User Story",
        projectActive: true,
        inProject: true,
        status: null,
      }),
    ];
    expect(codesFor(issues, 5)).toContain("missingStatus");
  });
});

describe("assignee rules", () => {
  it("flags a Feature with no assignee", () => {
    expect(codesFor([happyFeature({ assignees: [] })], 2)).toContain(
      "featureNeedsAssignee"
    );
  });

  it("flags started work with no assignee (project active)", () => {
    const issues = [
      mk({
        number: 5,
        type: "Task",
        parentId: "i3",
        parentNumber: 3,
        parentType: "User Story",
        projectActive: true,
        inProject: true,
        status: "In Progress",
        assignees: [],
      }),
    ];
    expect(codesFor(issues, 5)).toContain("startedNeedsAssignee");
  });
});

describe("buildTree stats + nesting", () => {
  it("nests children under their parent", () => {
    const { roots, byId } = buildTree([happyEpic(), happyFeature()]);
    expect(roots).toHaveLength(1);
    expect(roots[0].number).toBe(1);
    expect(roots[0].children.map((c) => c.number)).toEqual([2]);
    expect(byId.size).toBe(2);
  });

  it("computes type, rule and severity tallies", () => {
    const { stats } = buildTree([
      mk({ number: 1 }), // untyped → error
      happyEpic({ number: 2 }), // clean
    ]);
    expect(stats.total).toBe(2);
    expect(stats.byType.none).toBe(1);
    expect(stats.byType.epic).toBe(1);
    expect(stats.byRule.untyped).toBe(1);
    expect(stats.errors).toBe(1);
    expect(stats.clean).toBe(1);
    expect(stats.flagged).toBe(1);
  });

  it("marks hasProblemsDeep up the ancestry", () => {
    // Clean epic, but its child task is an orphan-by-wrong-parent.
    const epic = happyEpic();
    const badChild = mk({
      number: 9,
      type: "Task",
      parentId: "i1",
      parentNumber: 1,
      parentType: "Epic", // wrong parent for a Task
    });
    const { roots } = buildTree([epic, badChild]);
    expect(roots[0].hasProblemsDeep).toBe(true);
  });
});

describe("config-driven hierarchy", () => {
  it("compiles the default config into a 4-level chain", () => {
    const H = compileConfig(DEFAULT_CONFIG);
    expect(H.levelCount).toBe(4);
    expect(H.leafLevel).toBe(3);
    expect(H.sprintExemptBelow).toBe(2);
    expect(H.assigneeLevel).toBe(1);
    expect(H.typeMetaOf("Bug").level).toBe(3);
    expect(H.typeMetaOf("user-story").label).toBe("User Story");
    expect(H.typeMetaOf("defect").label).toBe("Bug"); // alias
  });

  it("validates against a custom 3-level config", () => {
    const config = {
      levels: [["Initiative"], ["Story"], ["Task"]],
    };
    // A Story under an Initiative is clean; under nothing it's an orphan.
    const issues = [
      mk({ number: 1, type: "Initiative", subIssueCount: 1 }),
      mk({
        number: 2,
        type: "Story",
        parentId: "i1",
        parentNumber: 1,
        parentType: "Initiative",
        subIssueCount: 1,
        assignees: [{ login: "a", avatarUrl: "" }],
      }),
      mk({ number: 3, type: "Epic" }), // unknown type in this config
    ];
    const { byId } = buildTree(issues, config);
    const find = (n) => [...byId.values()].find((x) => x.number === n);
    expect(find(2).problems.map((p) => p.code)).toEqual([]);
    expect(find(3).problems.map((p) => p.code)).toContain("unknownType");
  });

  it("generalises the sprint rule: only top levels are exempt", () => {
    // 3 levels → sprintExemptBelow = 1 → only Initiative (level 0) is exempt.
    const config = { levels: [["Initiative"], ["Story"], ["Task"]] };
    const inSprint = (over) =>
      buildTree(
        [mk({ subIssueCount: 1, sprint: { name: "S1", state: "current" }, ...over })],
        config
      );
    const initiative = inSprint({ number: 1, type: "Initiative" });
    const story = inSprint({
      number: 2,
      type: "Story",
      parentId: "x",
      parentType: "Initiative",
    });
    const codes = (t, n) =>
      [...t.byId.values()].find((x) => x.number === n).problems.map((p) => p.code);
    expect(codes(initiative, 1)).toContain("containerInSprint");
    expect(codes(story, 2)).not.toContain("containerInSprint");
  });

  it("flags disallowed labels only when enforceLabels is on", () => {
    const base = {
      number: 1,
      type: "Epic",
      subIssueCount: 1,
      labels: ["bug", "wontfix"],
    };
    // Off by default — no label rule.
    expect(codesFor([mk(base)], 1)).not.toContain("disallowedLabel");

    const config = {
      ...DEFAULT_CONFIG,
      allowedLabels: ["bug", "tech-debt"],
      enforceLabels: true,
    };
    const { byId } = buildTree([mk(base)], config);
    const node = [...byId.values()].find((n) => n.number === 1);
    const dl = node.problems.find((p) => p.code === "disallowedLabel");
    expect(dl).toBeTruthy();
    expect(dl.detail).toContain("wontfix");
    expect(dl.detail).not.toContain("bug");
  });

  it("accepts label objects ({ name }) and is case-insensitive", () => {
    const config = {
      ...DEFAULT_CONFIG,
      allowedLabels: ["Bug"],
      enforceLabels: true,
    };
    const issues = [
      mk({ number: 1, type: "Epic", subIssueCount: 1, labels: [{ name: "BUG" }] }),
    ];
    expect(
      [...buildTree(issues, config).byId.values()][0].problems.map((p) => p.code)
    ).not.toContain("disallowedLabel");
  });

  it("exposes the compiled hierarchy on the tree result", () => {
    const { hierarchy } = buildTree([happyEpic()], DEFAULT_CONFIG);
    expect(hierarchy.__compiled).toBe(true);
    expect(hierarchy.rules.some((r) => r.id === "containerInSprint")).toBe(true);
    expect(hierarchy.rules.some((r) => r.id === "epicInSprint")).toBe(false);
  });
});
