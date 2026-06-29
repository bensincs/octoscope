"use client";
import { useState } from "react";
import { TYPES as DEFAULT_TYPES, RULES_BY_ID as DEFAULT_RULES_BY_ID } from "@/lib/hierarchy";
import { toMarkdown, toCSV, downloadFile } from "@/lib/report";
import RulesPanel from "@/components/RulesPanel";
import IssueTree from "@/components/IssueTree";

function StatCard({ label, value, tone = "default" }) {
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "attention"
      ? "text-attention"
      : tone === "success"
      ? "text-success"
      : "text-fg";
  return (
    <div className="gh-card px-4 py-3">
      <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  );
}

function Legend({ byType, types }) {
  const items = [
    ...types.map((t) => ({
      key: t.key,
      label: t.label,
      accent: t.accent,
      count: byType[t.key] || 0,
    })),
    { key: "none", label: "No type", accent: "var(--danger)", count: byType.none || 0 },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.accent }} />
          {it.label}
          <span className="font-semibold text-fg">{it.count}</span>
        </span>
      ))}
    </div>
  );
}

function relativeTime(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function RateLimit({ rateLimit }) {
  if (!rateLimit) return null;
  const low = rateLimit.remaining < 500;
  const reset = rateLimit.resetAt ? new Date(rateLimit.resetAt) : null;
  const mins = reset ? Math.max(0, Math.round((reset - Date.now()) / 60000)) : null;
  return (
    <span
      className={`text-xs ${low ? "text-danger" : "text-muted"}`}
      title={`GitHub GraphQL budget${mins != null ? ` · resets in ${mins}m` : ""}`}
    >
      API {rateLimit.remaining.toLocaleString()}/{rateLimit.limit.toLocaleString()}
    </span>
  );
}

function LiveStatus({ streaming, refreshing, lastUpdated, loaded, total, onRefresh }) {
  let dotClass = "bg-success";
  let text;
  if (streaming) {
    dotClass = "bg-accent animate-pulse";
    text = total ? `Loading ${loaded} of ${total} issues…` : "Loading issues…";
  } else if (refreshing) {
    dotClass = "bg-accent animate-pulse";
    text = "Refreshing…";
  } else if (lastUpdated) {
    text = `Updated ${relativeTime(lastUpdated)}`;
  } else {
    text = "Live";
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
      <span>{text}</span>
      {!streaming && !refreshing && (
        <button
          onClick={onRefresh}
          className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted transition hover:bg-subtle hover:text-fg"
        >
          Refresh now
        </button>
      )}
    </div>
  );
}

function WarningsBanner({ warnings }) {
  if (!warnings || warnings.length === 0) return null;
  const seen = new Set();
  const unique = warnings.filter((w) =>
    seen.has(w.message) ? false : (seen.add(w.message), true)
  );
  return (
    <div className="rounded-md border border-attention/40 bg-attention/10 px-4 py-2.5 text-sm text-attention">
      {unique.map((w, i) => (
        <div key={i} className="flex items-start gap-2">
          <span aria-hidden>⚠</span>
          <span>{w.message}</span>
        </div>
      ))}
    </div>
  );
}

function ExportMenu({ result, tree }) {
  const [copied, setCopied] = useState(false);
  const stamp = (result.repo?.name || "issues").replace(/[^a-z0-9_-]/gi, "-");

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(toMarkdown(result, tree));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard failures (e.g. insecure context)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={copyMarkdown}
        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:bg-subtle hover:text-fg"
      >
        {copied ? "Copied!" : "Copy Markdown"}
      </button>
      <button
        onClick={() =>
          downloadFile(`${stamp}-audit.md`, toMarkdown(result, tree), "text/markdown")
        }
        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:bg-subtle hover:text-fg"
      >
        .md
      </button>
      <button
        onClick={() => downloadFile(`${stamp}-audit.csv`, toCSV(tree), "text/csv")}
        className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition hover:bg-subtle hover:text-fg"
      >
        .csv
      </button>
    </div>
  );
}

export default function AuditView({
  result,
  tree,
  streaming = false,
  refreshing = false,
  lastUpdated = null,
  rateLimit = null,
  onRefresh,
}) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [ruleFilter, setRuleFilter] = useState(null);
  const { stats } = tree;
  const hierarchy = tree.hierarchy;
  const types = hierarchy?.types || DEFAULT_TYPES;
  const rules = hierarchy?.rules;
  const rulesById = hierarchy?.rulesById || DEFAULT_RULES_BY_ID;
  const activeRuleTitle = ruleFilter ? rulesById[ruleFilter]?.title : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-fg">
          {result.repo?.nameWithOwner || result.repo?.name}
        </h1>
        {result.project && (
          <a
            href={result.project.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-subtle px-2.5 py-0.5 text-xs text-muted hover:text-fg"
          >
            Project: {result.project.title}
          </a>
        )}
        {!result.projectActive && (
          <span className="rounded-full border border-border bg-subtle px-2.5 py-0.5 text-xs text-muted">
            No project — hierarchy &amp; assignee rules only
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <RateLimit rateLimit={rateLimit} />
          <LiveStatus
            streaming={streaming}
            refreshing={refreshing}
            lastUpdated={lastUpdated}
            loaded={stats.total}
            total={result.total}
            onRefresh={onRefresh}
          />
        </div>
      </div>

      <WarningsBanner warnings={result.warnings} />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Issues audited" value={stats.total} />
        <StatCard label="Clean" value={stats.clean} tone="success" />
        <StatCard label="Flagged" value={stats.flagged} tone="attention" />
        <StatCard label="Errors" value={stats.errors} tone="danger" />
        <StatCard label="Warnings" value={stats.warnings} tone="attention" />
      </div>

      {/* Rulebook */}
      <RulesPanel
        rules={rules}
        byRule={stats.byRule}
        projectActive={result.projectActive}
        activeRule={ruleFilter}
        onSelectRule={setRuleFilter}
      />

      {/* Tree toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Legend byType={stats.byType} types={types} />
        <div className="flex items-center gap-3">
          <ExportMenu result={result} tree={tree} />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(e) => setOnlyProblems(e.target.checked)}
            />
            Show only problems
          </label>
        </div>
      </div>

      {ruleFilter && (
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-full border border-accent bg-accent/10 px-3 py-1 text-xs text-fg">
            Filtering by rule: {activeRuleTitle}
          </span>
          <button
            onClick={() => setRuleFilter(null)}
            className="text-xs text-muted hover:text-accent"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Tree */}
      <IssueTree
        roots={tree.roots}
        onlyProblems={onlyProblems}
        ruleFilter={ruleFilter}
        hierarchy={hierarchy}
      />
    </div>
  );
}
