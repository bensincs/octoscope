import { describe, it, expect } from "vitest";
import { buildTree, DEFAULT_CONFIG } from "@/lib/hierarchy";
import { toCSV, toMarkdown } from "@/lib/report";

// Minimal issue factory (mirrors hierarchy.test.js).
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

const cleanEpic = (over = {}) =>
  mk({ number: 1, type: "Epic", subIssueCount: 1, ...over });

const result = (over = {}) => ({
  repo: { name: "demo", nameWithOwner: "acme/demo" },
  project: null,
  projectActive: false,
  ...over,
});

describe("report / toCSV", () => {
  it("emits a header row and one row per issue, sorted by number", () => {
    const tree = buildTree([
      mk({ number: 2, type: "Bug", parentId: "i1", parentType: "User Story" }),
      cleanEpic(),
    ]);
    const lines = toCSV(tree).split("\n");
    expect(lines[0]).toBe(
      "number,title,type,state,status,sprint,sprintState,assignees,parent,violations,url"
    );
    expect(lines).toHaveLength(3); // header + 2 issues
    expect(lines[1].startsWith("1,")).toBe(true); // sorted: #1 first
    expect(lines[2].startsWith("2,")).toBe(true);
  });

  it("joins assignee logins with a space and lists violation codes", () => {
    const tree = buildTree([
      mk({
        number: 5,
        type: "Feature", // orphan (no parent) + needs assignee handled below
        parentId: "i1",
        parentNumber: 1,
        parentType: "Epic",
        subIssueCount: 1,
        assignees: [
          { login: "alice", avatarUrl: "" },
          { login: "bob", avatarUrl: "" },
        ],
      }),
    ]);
    const row = toCSV(tree).split("\n")[1];
    expect(row).toContain("alice bob");
  });

  it("records violation codes for a flagged issue", () => {
    const tree = buildTree([mk({ number: 1 })]); // untyped
    const row = toCSV(tree).split("\n")[1];
    expect(row).toContain("untyped");
  });

  it("escapes commas and quotes in titles per RFC-4180", () => {
    const tree = buildTree([
      cleanEpic({ title: 'Fix "thing", urgently' }),
    ]);
    const row = toCSV(tree).split("\n")[1];
    expect(row).toContain('"Fix ""thing"", urgently"');
  });
});

describe("report / toMarkdown", () => {
  it("includes repo name and summary stats", () => {
    const tree = buildTree([cleanEpic(), mk({ number: 2 })]); // 1 clean, 1 untyped
    const md = toMarkdown(result(), tree);
    expect(md).toContain("# Issue hygiene report — acme/demo");
    expect(md).toContain("**2** issues");
    expect(md).toContain("**1** clean");
  });

  it("reports a clean bill of health when there are no violations", () => {
    const tree = buildTree([cleanEpic()]);
    const md = toMarkdown(result(), tree);
    expect(md).toContain("No rule violations found");
    expect(md).not.toContain("## Violations by rule");
  });

  it("groups offenders under their violated rule with links", () => {
    const tree = buildTree([mk({ number: 7, title: "No type here" })]); // untyped
    const md = toMarkdown(result(), tree);
    expect(md).toContain("## Violations by rule");
    expect(md).toContain("Every issue has an Issue Type — 1 (error)");
    expect(md).toContain("[#7](https://example/7) No type here");
  });

  it("shows the project title when a project is connected", () => {
    const tree = buildTree([cleanEpic()]);
    const md = toMarkdown(
      result({ project: { title: "Roadmap", url: "https://p" } }),
      tree
    );
    expect(md).toContain("Project: **Roadmap**");
  });

  it("uses the tree's config-specific rulebook (containerInSprint, not epicInSprint)", () => {
    const tree = buildTree(
      [cleanEpic({ sprint: { name: "S1", state: "current" } })],
      { ...DEFAULT_CONFIG } // projectActive irrelevant; sprint present
    );
    const md = toMarkdown(result(), tree);
    // containerInSprint rule title is generated from the config.
    expect(md).toContain("are NOT in a sprint");
  });
});
