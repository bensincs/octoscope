// Config-driven hierarchy model + read-only validation.
//
// A "config" describes the issue-type hierarchy for one audit project:
//   {
//     levels: [["Epic"], ["Feature"], ["User Story"], ["Task", "Bug"]],
//     aliases: { defect: "Bug" },     // incoming type name → canonical label
//     allowedLabels: ["bug", "tech-debt"],
//     enforceLabels: false,
//   }
//
// `levels` is the ordered container chain, top → bottom. Each entry lists the
// type names allowed at that depth (multiple types may share a level, e.g.
// Task and Bug are both leaves under a User Story).
//
// compileConfig(config) turns a raw config into `H`, a compiled helper bundle
// (type lookups, level metadata, and the rendered RULES for that config).
// Everything downstream (validation, stats, UI) threads `H` so a project's own
// rulebook drives the audit. The DEFAULT_CONFIG-compiled bundle backs the
// static exports (RULES / TYPES / LEVELS / typeMetaOf …) for back-compat.

// ---------------------------------------------------------------------------
// Default configuration — preserves the original Epic › Feature › User Story ›
// Task chain with Bug as a leaf beside Task.
// ---------------------------------------------------------------------------
export const DEFAULT_CONFIG = {
  levels: [["Epic"], ["Feature"], ["User Story"], ["Task", "Bug"]],
  aliases: { defect: "Bug" },
  allowedLabels: [],
  enforceLabels: false,
};

// Accent palette. Known type names keep their original colours; anything else
// falls back to a per-level palette so custom hierarchies still look distinct.
const BUILTIN_ACCENTS = {
  epic: "#a78bfa",
  feature: "#60a5fa",
  userstory: "#34d399",
  task: "#fbbf24",
  bug: "#fb7185",
};
const LEVEL_PALETTE = [
  "#a78bfa",
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#22d3ee",
  "#a3e635",
  "#fb923c",
];

function norm(s) {
  return String(s ?? "").trim().toLowerCase();
}
function normKey(s) {
  return norm(s).replace(/[\s_-]+/g, "");
}

// ---------------------------------------------------------------------------
// Status helpers (config-independent).
// ---------------------------------------------------------------------------

// A status counts as "in progress" if it contains "progress" or is "doing".
const IN_PROGRESS_RE = /progress|^\s*doing\s*$/i;
export function isInProgress(status) {
  return !!status && IN_PROGRESS_RE.test(status);
}

// A status counts as a "done/closed" column.
const DONE_RE = /done|complete|closed|shipped|released|merged/i;
export function isDoneStatus(status) {
  return !!status && DONE_RE.test(status);
}

// "Not started" columns. Everything else counts as "in progress or beyond".
const TODO_RE =
  /^\s*(todo|to[\s-]?do|backlog|triage|icebox|new|ready|proposed|draft|no status|on hold)\s*$/i;
export function isStarted(status) {
  return !!status && !TODO_RE.test(status);
}

// ---------------------------------------------------------------------------
// Config normalisation + compilation.
// ---------------------------------------------------------------------------
function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  let levels = Array.isArray(c.levels) ? c.levels : DEFAULT_CONFIG.levels;
  levels = levels
    .map((lvl) =>
      (Array.isArray(lvl) ? lvl : [lvl])
        .map((t) => String(t ?? "").trim())
        .filter(Boolean)
    )
    .filter((lvl) => lvl.length > 0);
  if (levels.length === 0) levels = DEFAULT_CONFIG.levels;

  return {
    levels,
    aliases:
      c.aliases && typeof c.aliases === "object" && !Array.isArray(c.aliases)
        ? c.aliases
        : {},
    accents:
      c.accents && typeof c.accents === "object" && !Array.isArray(c.accents)
        ? c.accents
        : undefined,
    allowedLabels: Array.isArray(c.allowedLabels) ? c.allowedLabels : [],
    enforceLabels: !!c.enforceLabels,
  };
}

/**
 * Compile a raw config into the `H` helper bundle used everywhere.
 * Accepts an already-compiled bundle and returns it unchanged (idempotent).
 */
export function compileConfig(rawConfig) {
  if (rawConfig && rawConfig.__compiled) return rawConfig;

  const config = normalizeConfig(rawConfig);
  const levels = config.levels;

  // Type registry.
  const types = [];
  const byKey = new Map();
  levels.forEach((typeNames, level) => {
    typeNames.forEach((label, i) => {
      const key = normKey(label);
      const accent =
        config.accents?.[key] ||
        config.accents?.[label] ||
        BUILTIN_ACCENTS[key] ||
        LEVEL_PALETTE[(level + i) % LEVEL_PALETTE.length];
      const meta = { key, label, level, accent };
      types.push(meta);
      if (!byKey.has(key)) byKey.set(key, meta);
    });
  });

  // Aliases: alias name → canonical type meta.
  const aliasMap = new Map();
  for (const [alias, target] of Object.entries(config.aliases)) {
    const meta = byKey.get(normKey(target));
    if (meta) aliasMap.set(normKey(alias), meta);
  }

  const levelCount = levels.length;
  const leafLevel = levelCount - 1;
  // Levels whose index is < sprintExemptBelow must NOT sit in a sprint.
  // Default: 4 levels → 2 → Epic(0) & Feature(1) are exempt.
  const sprintExemptBelow = Math.max(0, levelCount - 2);
  // The level that must always carry an assignee (Feature = index 1).
  const assigneeLevel = Math.min(1, leafLevel);

  const levelLabels = levels.map((arr) => arr.join(" / "));
  const levelMetas = levels.map((typeNames, index) => ({
    index,
    label: levelLabels[index],
    types: typeNames,
    accent: types.find((t) => t.level === index)?.accent,
  }));

  const allowedLabelSet = new Set(config.allowedLabels.map(norm).filter(Boolean));

  function typeMetaOf(name) {
    if (!name) return null;
    const k = normKey(name);
    return byKey.get(k) || aliasMap.get(k) || null;
  }
  function levelOf(name) {
    const m = typeMetaOf(name);
    return m ? m.level : -1;
  }

  const H = {
    __compiled: true,
    config,
    levels: levelMetas,
    levelCount,
    leafLevel,
    sprintExemptBelow,
    assigneeLevel,
    types,
    typeMetaOf,
    levelOf,
    levelLabel: (i) => levelLabels[i] ?? null,
    chainLabel: levelLabels.join(" › "),
    allTypeLabels: types.map((t) => t.label),
    allowedLabelSet,
    enforceLabels: config.enforceLabels && allowedLabelSet.size > 0,
  };
  H.rules = buildRules(H);
  H.rulesById = Object.fromEntries(H.rules.map((r) => [r.id, r]));
  return H;
}

// ---------------------------------------------------------------------------
// THE RULEBOOK — generated per-config so descriptions reflect the hierarchy.
// ---------------------------------------------------------------------------
function buildRules(H) {
  const top = H.levels[0]?.label || "Top-level";
  const chain = H.chainLabel;
  const typeList = H.allTypeLabels.join(", ");
  const containerLevels = H.levels
    .filter((l) => l.index < H.leafLevel)
    .map((l) => l.label);
  const sprintExemptLabels = H.levels
    .filter((l) => l.index < H.sprintExemptBelow)
    .map((l) => l.label);
  const assigneeLabel = H.levels[H.assigneeLevel]?.label || "items";

  const rules = [
    {
      id: "untyped",
      group: "Hierarchy",
      severity: "error",
      needsProject: false,
      title: "Every issue has an Issue Type",
      desc: `Issues with no type can't be placed in the ${chain} chain.`,
    },
    {
      id: "unknownType",
      group: "Hierarchy",
      severity: "error",
      needsProject: false,
      title: "Types stay within the chain",
      desc: `Only ${typeList} are allowed.`,
    },
    {
      id: "epicHasParent",
      group: "Hierarchy",
      severity: "error",
      needsProject: false,
      title: `${top}s are top-level`,
      desc: `A ${top} is the root of the tree and must not have a parent.`,
    },
    {
      id: "orphan",
      group: "Hierarchy",
      severity: "error",
      needsProject: false,
      title: "No orphans",
      desc: "Every issue below the top level must be nested under the level directly above it.",
    },
    {
      id: "wrongParent",
      group: "Hierarchy",
      severity: "error",
      needsProject: false,
      title: "Parent is exactly one level up",
      desc: `An issue's parent must be exactly one level above it in the ${chain} chain.`,
    },
    {
      id: "parentUntyped",
      group: "Hierarchy",
      severity: "error",
      needsProject: false,
      title: "Parents are typed",
      desc: "A parent issue with no Issue Type can't be validated.",
    },
    {
      id: "emptyContainer",
      group: "Hierarchy",
      severity: "warning",
      needsProject: false,
      title: "Containers aren't empty",
      desc: `${containerLevels.join(", ") || "Containers"} should have at least one sub-issue.`,
    },
    {
      id: "containerInSprint",
      group: "Sprint",
      severity: "error",
      needsProject: true,
      title: `${sprintExemptLabels.join(" & ") || "Containers"} are NOT in a sprint`,
      desc: "High-level containers span many sprints, so they must not be assigned to an iteration — the lower levels carry the sprint.",
    },
    {
      id: "inProgressPastSprint",
      group: "Sprint",
      severity: "error",
      needsProject: true,
      title: "In-progress work isn't in a past sprint",
      desc: "Anything still In Progress must move to the current sprint, not sit in a finished one.",
    },
    {
      id: "closedNotDone",
      group: "Status",
      severity: "error",
      needsProject: true,
      title: "Closed issues are marked Done",
      desc: "If an issue is closed on GitHub, its board status should be a Done/closed column — not Todo or In Progress.",
    },
    {
      id: "openButDone",
      group: "Status",
      severity: "error",
      needsProject: true,
      title: "Done items are closed",
      desc: "If the board status is Done, the GitHub issue should be closed. Open 'Done' work is a false signal.",
    },
    {
      id: "missingFromProject",
      group: "Project",
      severity: "warning",
      needsProject: true,
      title: "Open issues are on the board",
      desc: "Every open issue should be added to the project so it's tracked, statused and scheduled.",
    },
    {
      id: "missingStatus",
      group: "Project",
      severity: "error",
      needsProject: true,
      title: "Every issue has a project status",
      desc: "Items on the board must have a Status set — none should sit in the 'No Status' column.",
    },
    {
      id: "featureNeedsAssignee",
      group: "Assignee",
      severity: "error",
      needsProject: false,
      title: `Every ${assigneeLabel} has an assignee`,
      desc: `Each ${assigneeLabel} needs an owner (DRI) responsible for delivering it.`,
    },
    {
      id: "startedNeedsAssignee",
      group: "Assignee",
      severity: "error",
      needsProject: true,
      title: "In-progress work is assigned",
      desc: "Anything In Progress or beyond must have at least one assignee — work in flight needs an owner.",
    },
  ];

  if (H.config.enforceLabels) {
    const list = H.config.allowedLabels;
    rules.push({
      id: "disallowedLabel",
      group: "Labels",
      severity: "error",
      needsProject: false,
      title: "Only approved labels are used",
      desc: `Labels must come from the project's allowed list${
        list.length ? `: ${list.join(", ")}` : ""
      }.`,
    });
  }

  return rules;
}

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => (typeof l === "string" ? l : l?.name))
    .filter(Boolean);
}

function problem(H, id, detailOverride) {
  const r = H.rulesById[id];
  return {
    code: id,
    severity: r.severity,
    title: r.title,
    detail: detailOverride || r.desc,
  };
}

/**
 * Validate one flat issue against a compiled config `H`.
 * `issue` may carry project fields:
 *   issue.sprint  = { name, state: "past"|"current"|"future" } | null
 *   issue.status  = string | null
 *   issue.labels  = (string | { name })[] | undefined
 */
function validateIssue(issue, H) {
  const problems = [];
  const lvl = H.levelOf(issue.type);
  const typeLabel = H.typeMetaOf(issue.type)?.label || issue.type;

  // ---- Typing + hierarchy ----
  if (!issue.type) {
    problems.push(problem(H, "untyped"));
  } else if (lvl === -1) {
    problems.push(
      problem(H, "unknownType", `Type "${issue.type}" isn't part of the chain.`)
    );
  } else if (lvl === 0) {
    if (issue.parentId) problems.push(problem(H, "epicHasParent"));
  } else {
    const parentLvl = H.levelOf(issue.parentType);
    const expected = H.levelLabel(lvl - 1);
    if (!issue.parentId) {
      problems.push(
        problem(H, "orphan", `A ${typeLabel} should sit under a ${expected}.`)
      );
    } else if (!issue.parentType) {
      problems.push(problem(H, "parentUntyped"));
    } else if (parentLvl !== lvl - 1) {
      problems.push(
        problem(
          H,
          "wrongParent",
          `A ${typeLabel} should be a child of a ${expected}, but its parent is a ${issue.parentType}.`
        )
      );
    }
  }
  if (lvl >= 0 && lvl < H.leafLevel && issue.subIssueCount === 0) {
    problems.push(problem(H, "emptyContainer"));
  }

  // ---- Sprint rules (only when project data is present) ----
  if (issue.sprint) {
    if (lvl >= 0 && lvl < H.sprintExemptBelow) {
      problems.push(
        problem(
          H,
          "containerInSprint",
          `This ${typeLabel} is assigned to sprint "${issue.sprint.name}".`
        )
      );
    }
    if (issue.sprint.state === "past" && isInProgress(issue.status)) {
      problems.push(
        problem(
          H,
          "inProgressPastSprint",
          `Status is "${issue.status}" but it's parked in the finished sprint "${issue.sprint.name}".`
        )
      );
    }
  }

  // ---- Open/Closed ↔ board Status synergy ----
  if (issue.status) {
    const done = isDoneStatus(issue.status);
    if (issue.state === "CLOSED" && !done) {
      problems.push(
        problem(
          H,
          "closedNotDone",
          `Issue is closed on GitHub, but its board status is still "${issue.status}".`
        )
      );
    } else if (issue.state === "OPEN" && done) {
      problems.push(
        problem(
          H,
          "openButDone",
          `Board status is "${issue.status}" but the issue is still open on GitHub.`
        )
      );
    }
  }

  // ---- Project membership ----
  if (issue.projectActive && issue.state === "OPEN" && !issue.inProject) {
    problems.push(
      problem(
        H,
        "missingFromProject",
        `This open ${typeLabel || "issue"} isn't on the connected project board.`
      )
    );
  }

  // ---- Project status presence (for items that ARE on the board) ----
  if (issue.projectActive && issue.inProject && !issue.status) {
    problems.push(problem(H, "missingStatus"));
  }

  // ---- Assignee rules ----
  const noAssignee = !issue.assignees || issue.assignees.length === 0;
  if (noAssignee && lvl === H.assigneeLevel) {
    problems.push(problem(H, "featureNeedsAssignee"));
  }
  if (noAssignee && issue.projectActive && isStarted(issue.status)) {
    problems.push(
      problem(
        H,
        "startedNeedsAssignee",
        `Status is "${issue.status}" but nobody is assigned.`
      )
    );
  }

  // ---- Label allow-list ----
  if (H.enforceLabels) {
    const bad = normalizeLabels(issue.labels).filter(
      (l) => !H.allowedLabelSet.has(norm(l))
    );
    if (bad.length) {
      problems.push(
        problem(
          H,
          "disallowedLabel",
          `Label${bad.length > 1 ? "s" : ""} not in the allowed list: ${bad.join(", ")}.`
        )
      );
    }
  }

  return problems;
}

/**
 * Build a nested tree from flat issues and attach validation results.
 * Pass a raw config (or a compiled `H`); defaults to the precompiled DEFAULT.
 */
export function buildTree(issues, config = DEFAULT) {
  const H = compileConfig(config);
  const byId = new Map();

  for (const issue of issues) {
    byId.set(issue.id, {
      ...issue,
      level: H.levelOf(issue.type),
      children: [],
      problems: validateIssue(issue, H),
    });
  }

  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (arr) =>
    arr.sort((a, b) => {
      const la = a.level === -1 ? 99 : a.level;
      const lb = b.level === -1 ? 99 : b.level;
      if (la !== lb) return la - lb;
      return a.number - b.number;
    });
  sortNodes(roots);
  for (const node of byId.values()) sortNodes(node.children);

  const markDeep = (node) => {
    let deep = node.problems.length > 0;
    for (const c of node.children) if (markDeep(c)) deep = true;
    node.hasProblemsDeep = deep;
    return deep;
  };
  roots.forEach(markDeep);

  return { roots, byId, stats: computeStats(byId, H), hierarchy: H };
}

function computeStats(byId, H) {
  const stats = {
    total: byId.size,
    clean: 0,
    errors: 0,
    warnings: 0,
    flagged: 0,
    byType: Object.fromEntries([...H.types.map((t) => [t.key, 0]), ["none", 0]]),
    byRule: Object.fromEntries(H.rules.map((r) => [r.id, 0])),
  };
  for (const node of byId.values()) {
    const tm = H.typeMetaOf(node.type);
    if (tm) stats.byType[tm.key]++;
    else stats.byType.none++;

    if (node.problems.some((p) => p.severity === "error")) stats.errors++;
    if (node.problems.some((p) => p.severity === "warning")) stats.warnings++;
    if (node.problems.length) stats.flagged++;
    else stats.clean++;

    for (const p of node.problems) {
      if (p.code in stats.byRule) stats.byRule[p.code]++;
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Static exports backed by DEFAULT_CONFIG (back-compat for un-threaded callers).
// ---------------------------------------------------------------------------
const DEFAULT = compileConfig(DEFAULT_CONFIG);

export const RULES = DEFAULT.rules;
export const RULES_BY_ID = DEFAULT.rulesById;
export const TYPES = DEFAULT.types;
export const LEVELS = DEFAULT.levels;

export function typeMetaOf(typeName) {
  return DEFAULT.typeMetaOf(typeName);
}
export function levelOf(typeName) {
  return DEFAULT.levelOf(typeName);
}
export function levelMeta(idx) {
  return DEFAULT.levels[idx] || null;
}
