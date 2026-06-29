"use client";
import { useMemo, useState } from "react";
import { buildTree } from "@/lib/hierarchy";
import AuditView from "@/components/AuditView";
import { useToast } from "@/components/Toast";

// Run-audit surface for a saved project. Aggregates the project's repos/boards
// under its rulebook and renders the resulting tree.
export default function AuditRunner({ projectId, project, onEditSettings }) {
  const [includeClosed, setIncludeClosed] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const { error: toastError } = useToast();

  const noRepos = project.repos.length === 0;

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeClosed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Audit failed");
      setData(json);
    } catch (e) {
      setError(e.message);
      toastError(e.message);
    } finally {
      setRunning(false);
    }
  }

  const tree = useMemo(
    () => (data ? buildTree(data.issues, data.config) : null),
    [data]
  );

  const result = useMemo(() => {
    if (!data) return null;
    const repoLabel =
      data.repos.length === 1
        ? data.repos[0].nameWithOwner
        : `${project.name} · ${data.repos.length} repos`;
    return {
      repo: { name: project.name, nameWithOwner: repoLabel },
      project: null,
      projectActive: data.projectActive,
      warnings: data.warnings,
      total: data.issues.length,
    };
  }, [data, project.name]);

  return (
    <div className="space-y-4">
      <div className="gh-card flex flex-wrap items-center gap-3 p-4">
        <button
          onClick={run}
          disabled={running || noRepos}
          className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {running ? "Running…" : "Run audit"}
        </button>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
          />
          Include closed issues
        </label>
        <span className="text-xs text-muted">
          {project.repos.length} repo{project.repos.length === 1 ? "" : "s"} ·{" "}
          {project.boards.length} board{project.boards.length === 1 ? "" : "s"}
        </span>
        {noRepos && (
          <button
            onClick={onEditSettings}
            className="text-xs font-medium text-accent hover:underline"
          >
            Add a repository in Settings →
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {result && tree && <AuditView result={result} tree={tree} />}
    </div>
  );
}
