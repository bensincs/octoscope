"use client";
import { useMemo, useState } from "react";
import { typeMetaOf as defaultTypeMetaOf } from "@/lib/hierarchy";

const SPRINT_COLOR = {
  past: "#cf222e",
  current: "#1a7f37",
  future: "#0969da",
  unknown: "#656d76",
};

function SeverityDot({ severity }) {
  const color = severity === "error" ? "var(--danger)" : "var(--attention)";
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: color }}
    />
  );
}

function TypeBadge({ typeName, typeMetaOf }) {
  const meta = typeMetaOf(typeName);
  if (!meta) {
    return (
      <span className="rounded-md border border-danger/40 bg-danger/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-danger">
        {typeName || "No type"}
      </span>
    );
  }
  return (
    <span
      className="rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{
        color: meta.accent,
        background: `${meta.accent}1a`,
        border: `1px solid ${meta.accent}40`,
      }}
    >
      {meta.label}
    </span>
  );
}

function ProblemPills({ problems, ruleFilter }) {
  if (!problems.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {problems.map((p, i) => (
        <span
          key={i}
          title={p.detail}
          className={`group inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
            p.severity === "error"
              ? "bg-danger/10 text-danger border border-danger/30"
              : "bg-attention/10 text-attention border border-attention/30"
          } ${ruleFilter && p.code === ruleFilter ? "ring-2 ring-accent" : ""}`}
        >
          <SeverityDot severity={p.severity} />
          <span>{p.title}</span>
        </span>
      ))}
    </div>
  );
}

function IssueNode({ node, visibleIds, ruleFilter, typeMetaOf }) {
  const [open, setOpen] = useState(true);
  const meta = typeMetaOf(node.type);
  const accent = meta ? meta.accent : "var(--danger)";
  const hasChildren = node.children.length > 0;

  if (visibleIds && !visibleIds.has(node.id)) return null;

  const visibleChildren = visibleIds
    ? node.children.filter((c) => visibleIds.has(c.id))
    : node.children;

  const hasError = node.problems.some((p) => p.severity === "error");

  return (
    <div className="animate-fadeup">
      <div
        className="group relative flex items-start gap-3 rounded-xl border bg-canvas px-3 py-2.5 transition hover:bg-subtle"
        style={{
          borderColor: hasError ? "color-mix(in srgb, var(--danger) 45%, transparent)" : "var(--border)",
        }}
      >
        <span
          className="absolute left-0 top-2 bottom-2 w-1 rounded-full"
          style={{ background: accent }}
        />

        <button
          onClick={() => setOpen((o) => !o)}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted transition hover:text-fg ${
            hasChildren ? "" : "invisible"
          }`}
          aria-label={open ? "Collapse" : "Expand"}
        >
          <svg
            viewBox="0 0 20 20"
            className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
            fill="currentColor"
          >
            <path d="M7 5l6 5-6 5V5z" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge typeName={node.type} typeMetaOf={typeMetaOf} />
            <a
              href={node.url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-muted hover:text-fg"
            >
              #{node.number}
            </a>
            <a
              href={node.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 max-w-full truncate text-sm font-medium text-fg hover:underline"
            >
              {node.title}
            </a>
            {node.state === "CLOSED" && (
              <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                closed
              </span>
            )}
            {node.status && (
              <span className="rounded-full border border-border bg-subtle px-2 py-0.5 text-[10px] text-muted">
                {node.status}
              </span>
            )}
            {node.projectActive && !node.inProject && node.state === "OPEN" && (
              <span
                title="Not added to the connected project board"
                className="rounded-full border border-attention/40 bg-attention/10 px-2 py-0.5 text-[10px] font-medium text-attention"
              >
                Not on board
              </span>
            )}
            {node.sprint && (
              <span
                title={`Sprint state: ${node.sprint.state}`}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  color: SPRINT_COLOR[node.sprint.state] || "#656d76",
                  background: `${SPRINT_COLOR[node.sprint.state] || "#656d76"}1a`,
                  border: `1px solid ${
                    SPRINT_COLOR[node.sprint.state] || "#656d76"
                  }40`,
                }}
              >
                {node.sprint.state === "past"
                  ? "Past · "
                  : node.sprint.state === "current"
                  ? "Now · "
                  : node.sprint.state === "future"
                  ? "Next · "
                  : ""}
                {node.sprint.name}
              </span>
            )}
            {node.assignees?.length > 0 && (
              <span className="ml-auto flex items-center -space-x-1.5">
                {node.assignees.slice(0, 3).map((a) => (
                  <img
                    key={a.login}
                    src={a.avatarUrl}
                    alt={a.login}
                    title={a.login}
                    className="h-5 w-5 rounded-full border border-border bg-subtle"
                  />
                ))}
                {node.assignees.length > 3 && (
                  <span className="pl-2 text-[10px] text-muted">
                    +{node.assignees.length - 3}
                  </span>
                )}
              </span>
            )}
            {hasChildren && (
              <span
                className={`${
                  node.assignees?.length ? "" : "ml-auto"
                } shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[11px] text-muted`}
              >
                {node.children.length} sub
              </span>
            )}
          </div>
          <ProblemPills problems={node.problems} ruleFilter={ruleFilter} />
        </div>
      </div>

      {open && visibleChildren.length > 0 && (
        <div className="mt-1.5 ml-3 space-y-1.5 border-l border-bordermuted pl-3">
          {visibleChildren.map((child) => (
            <IssueNode
              key={child.id}
              node={child}
              visibleIds={visibleIds}
              ruleFilter={ruleFilter}
              typeMetaOf={typeMetaOf}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function IssueTree({ roots, onlyProblems, ruleFilter, hierarchy }) {
  const filtering = onlyProblems || !!ruleFilter;
  const typeMetaOf = hierarchy?.typeMetaOf || defaultTypeMetaOf;

  // Compute the set of node ids to show: a node is visible if it matches the
  // predicate, or any descendant does.
  const visibleIds = useMemo(() => {
    if (!filtering) return null;
    const match = (node) =>
      ruleFilter
        ? node.problems.some((p) => p.code === ruleFilter)
        : node.problems.length > 0;
    const set = new Set();
    const walk = (node) => {
      let anyChild = false;
      for (const c of node.children) if (walk(c)) anyChild = true;
      const show = match(node) || anyChild;
      if (show) set.add(node.id);
      return show;
    };
    roots.forEach(walk);
    return set;
  }, [roots, onlyProblems, ruleFilter, filtering]);

  const visibleRoots = visibleIds
    ? roots.filter((r) => visibleIds.has(r.id))
    : roots;

  if (visibleRoots.length === 0) {
    return (
      <div className="rounded-2xl border border-success/20 bg-success/5 p-10 text-center">
        <div className="text-4xl">✨</div>
        <p className="mt-3 text-lg font-semibold text-success">
          {filtering ? "No matching issues" : "Nothing to show"}
        </p>
        <p className="mt-1 text-sm text-muted">
          {ruleFilter
            ? "No issues violate this rule."
            : onlyProblems
            ? `Every issue fits cleanly into ${
                hierarchy?.chainLabel || "Epic › Feature › User Story › Task"
              }.`
            : "This repository has no issues to audit."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {visibleRoots.map((root) => (
        <IssueNode
          key={root.id}
          node={root}
          visibleIds={visibleIds}
          ruleFilter={ruleFilter}
          typeMetaOf={typeMetaOf}
        />
      ))}
    </div>
  );
}
