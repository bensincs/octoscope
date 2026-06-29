"use client";
import { useState } from "react";
import { CheckIcon } from "@primer/octicons-react";
import { RULES as DEFAULT_RULES } from "@/lib/hierarchy";

const GROUP_ORDER = ["Hierarchy", "Sprint", "Status", "Project", "Assignee", "Labels"];
const GROUP_COLOR = {
  Hierarchy: "#8250df",
  Sprint: "#bf3989",
  Status: "#1f883d",
  Project: "#9a6700",
  Assignee: "#0969da",
  Labels: "#0550ae",
};

function SeverityTag({ severity }) {
  const isErr = severity === "error";
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
        isErr
          ? "bg-danger/15 text-danger"
          : "bg-attention/15 text-attention"
      }`}
    >
      {isErr ? "Error" : "Warn"}
    </span>
  );
}

/**
 * Always-visible rulebook. `byRule` = { ruleId: violationCount } (optional).
 * `projectActive` toggles whether sprint rules are live or awaiting data.
 */
export default function RulesPanel({ rules = DEFAULT_RULES, byRule, projectActive, activeRule, onSelectRule }) {
  const [collapsed, setCollapsed] = useState(false);

  // Preserve the preferred group order, then append any custom groups.
  const presentGroups = [
    ...GROUP_ORDER.filter((g) => rules.some((r) => r.group === g)),
    ...[...new Set(rules.map((r) => r.group))].filter(
      (g) => !GROUP_ORDER.includes(g)
    ),
  ];
  const grouped = presentGroups.map((g) => ({
    group: g,
    rules: rules.filter((r) => r.group === g),
  }));

  const totalViolations = byRule
    ? rules.reduce((sum, r) => sum + (byRule[r.id] > 0 ? byRule[r.id] : 0), 0)
    : 0;

  return (
    <section className="gh-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 text-left"
          aria-expanded={!collapsed}
        >
          <ChevronIcon
            className={`h-4 w-4 text-muted transition-transform ${
              collapsed ? "-rotate-90" : ""
            }`}
          />
          <h2 className="text-base font-bold tracking-tight text-fg">
            The Rulebook
          </h2>
        </button>
        {!collapsed && (
          <span className="text-xs text-muted">
            Every issue is checked against these rules.
          </span>
        )}
        {collapsed && totalViolations > 0 && (
          <span className="rounded-full bg-danger/20 px-2 py-0.5 text-xs font-semibold text-danger">
            {totalViolations} violation{totalViolations === 1 ? "" : "s"}
          </span>
        )}
        <span
          className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ${
            projectActive
              ? "border border-success/30 bg-success/10 text-success"
              : "border border-border bg-subtle text-muted"
          }`}
        >
          {projectActive ? "Sprint rules active" : "Add a project for sprint rules"}
        </span>
      </div>

      {!collapsed && (
        <div className="mt-4 space-y-5">
          {grouped.map(({ group, rules }) => {
            const needsProject = rules.every((r) => r.needsProject);
            const dimmed = needsProject && !projectActive;
            const dotColor = GROUP_COLOR[group] || "#8250df";
            return (
              <div key={group}>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: dotColor }}
                  />
                  {group}
                  {dimmed && (
                    <span className="font-normal normal-case text-muted">
                      · needs a project
                    </span>
                  )}
                </h3>
                <ul className="space-y-1.5">
                  {rules.map((r) => {
                    const count = byRule?.[r.id] ?? null;
                    const violated = count > 0;
                    const isActive = activeRule === r.id;
                    const clickable = violated && !dimmed && onSelectRule;
                    return (
                      <li
                        key={r.id}
                        onClick={
                          clickable ? () => onSelectRule(isActive ? null : r.id) : undefined
                        }
                        className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 transition ${
                          clickable ? "cursor-pointer" : ""
                        } ${
                          dimmed
                            ? "border-border bg-subtle/40 opacity-50"
                            : isActive
                            ? "border-accent bg-accent/10"
                            : violated
                            ? "border-danger/30 bg-danger/[0.06] hover:border-danger/50"
                            : "border-border bg-subtle"
                        }`}
                      >
                        <SeverityTag severity={r.severity} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-fg">
                            {r.title}
                          </p>
                          <p className="text-xs leading-relaxed text-muted">
                            {r.desc}
                          </p>
                        </div>
                        {count !== null && !dimmed && (
                          <span
                            className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                              violated
                                ? "bg-danger/20 text-danger"
                                : "bg-success/15 text-success"
                            }`}
                            title={
                              violated
                                ? `${count} issue(s) violate this rule — click to filter`
                                : "No violations"
                            }
                          >
                            {violated ? count : <CheckIcon size={14} />}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ChevronIcon({ className }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M12.78 6.22a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06 0L3.22 7.28a.75.75 0 011.06-1.06L8 9.94l3.72-3.72a.75.75 0 011.06 0z" />
    </svg>
  );
}
