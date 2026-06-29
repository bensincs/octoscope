// Pure helpers that turn an audit result + tree into shareable reports.
import { RULES as DEFAULT_RULES, RULES_BY_ID } from "@/lib/hierarchy";

function flatNodes(tree) {
  return [...tree.byId.values()].sort((a, b) => a.number - b.number);
}

function csvCell(value) {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Full issue table as CSV (one row per issue). */
export function toCSV(tree) {
  const header = [
    "number",
    "title",
    "type",
    "state",
    "status",
    "sprint",
    "sprintState",
    "assignees",
    "parent",
    "violations",
    "url",
  ];
  const rows = flatNodes(tree).map((n) =>
    [
      n.number,
      n.title,
      n.type || "",
      n.state,
      n.status || "",
      n.sprint?.name || "",
      n.sprint?.state || "",
      (n.assignees || []).map((a) => a.login).join(" "),
      n.parentNumber ? `#${n.parentNumber}` : "",
      n.problems.map((p) => p.code).join(" "),
      n.url,
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

/** A human-readable Markdown report grouped by violated rule. */
export function toMarkdown(result, tree) {
  const { stats } = tree;
  const repo = result.repo?.nameWithOwner || result.repo?.name || "repository";
  const nodes = flatNodes(tree);
  const lines = [];

  lines.push(`# Issue hygiene report — ${repo}`);
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()}_`);
  if (result.project) lines.push(`Project: **${result.project.title}**`);
  lines.push("");
  lines.push(
    `**${stats.total}** issues · ` +
      `**${stats.clean}** clean · ` +
      `**${stats.flagged}** flagged · ` +
      `**${stats.errors}** with errors · ` +
      `**${stats.warnings}** with warnings`
  );
  lines.push("");

  const rules = tree.hierarchy?.rules || DEFAULT_RULES;
  const violatedRules = rules.filter((r) => (stats.byRule[r.id] || 0) > 0);
  if (violatedRules.length === 0) {
    lines.push("No rule violations found. 🎉");
    return lines.join("\n");
  }

  lines.push("## Violations by rule");
  lines.push("");
  for (const rule of violatedRules) {
    const offenders = nodes.filter((n) =>
      n.problems.some((p) => p.code === rule.id)
    );
    lines.push(
      `### ${rule.title} — ${offenders.length} (${rule.severity})`
    );
    for (const n of offenders) {
      const detail =
        n.problems.find((p) => p.code === rule.id)?.detail || "";
      lines.push(
        `- [#${n.number}](${n.url}) ${n.title}${detail ? ` — ${detail}` : ""}`
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Trigger a client-side file download. */
export function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { RULES_BY_ID };
