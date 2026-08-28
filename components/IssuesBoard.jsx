"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SyncIcon, AlertIcon, ClockIcon } from "@primer/octicons-react";
import { buildTree } from "@/lib/hierarchy";
import { describeAge, isStale } from "@/lib/pullRequests";
import AuditView from "@/components/AuditView";
import { Spinner } from "@/components/projectForms";
import { useToast } from "@/components/Toast";
import { readLocal, writeLocal, FEATURES } from "@/lib/browserStore";

// Issues surface for a saved project.
//
// The result is a SHARED CACHE: one member refreshes and everyone reads the
// snapshot, rather than each viewer re-running an audit that costs a GitHub API
// call per repo and per board.
//
// The cache holds the RAW issues; the rulebook is applied here at render time
// against the project's CURRENT config. Editing a rule therefore takes effect
// immediately, with no refetch — the same way pull-request rules work.
export default function IssuesBoard({ projectId, project }) {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/issues`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load issues");
      if (json.localOnly) {
        const local = await readLocal(projectId, FEATURES.ISSUES);
        // config comes from the server even locally: the rulebook is project
        // configuration, not GitHub data, and must stay live.
        setSnapshot(local ? { ...local, config: json.config, localOnly: true } : json);
      } else {
        setSnapshot(json);
      }
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/refresh`, {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.fields?.[0]?.message || json.error || "Refresh failed");
      }
      if (json.localOnly) {
        const stored = await writeLocal(projectId, FEATURES.ISSUES, json);
        if (!stored) {
          toast.error(
            "Couldn't save to this browser — the data is in memory and will be lost on reload."
          );
        }
      }
      setSnapshot(json);
      setError(null);
      toast.success(`Refreshed ${json.issueCount} issues.`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const data = snapshot?.result ?? null;

  // Deliberately snapshot.config (current) rather than data.config (whatever
  // was in force at refresh time) — that's what makes rule changes live.
  const tree = useMemo(
    () => (data ? buildTree(data.issues, snapshot?.config) : null),
    [data, snapshot?.config]
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

  if (!snapshot && !error) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  // Only the scan SCOPE can drift now. Closed issues aren't in the cache, so
  // turning them on genuinely needs another trip to GitHub — unlike a rulebook
  // change, which re-evaluates in place.
  const scopeChanged = snapshot?.includeClosedChanged;
  const stale = isStale(snapshot?.refreshedAt);

  return (
    <div className="space-y-4">
      <div className="gh-card flex flex-wrap items-center gap-3 p-4">
        <button
          onClick={refresh}
          disabled={busy}
          className="btn-primary inline-flex items-center gap-2 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <SyncIcon size={16} />}
          {busy ? "Refreshing…" : "Refresh"}
        </button>

        <span className="text-xs text-muted">
          refreshed {describeAge(snapshot?.refreshedAt)}
          {snapshot?.refreshedBy && ` by ${snapshot.refreshedBy}`}
          {" · "}
          {snapshot?.includeClosed ? "including closed" : "open only"}
        </span>

        <span className="text-xs text-muted">
          {project.repos.length} repo{project.repos.length === 1 ? "" : "s"} ·{" "}
          {project.boards.length} board{project.boards.length === 1 ? "" : "s"}
        </span>
      </div>

      {snapshot?.localOnly && (
        <p className="rounded-md border border-border bg-subtle px-3 py-2 text-xs text-muted">
          This project keeps GitHub data out of the database — what you see is
          stored in this browser only, so refreshing updates it for you alone.
        </p>
      )}

      {scopeChanged && data && (
        <div className="flex items-start gap-2 rounded-md border border-attention/40 bg-attention/10 px-3 py-2 text-xs text-fg">
          <span className="mt-0.5 text-attention">
            <AlertIcon size={16} />
          </span>
          <span>
            The “include closed issues” setting has changed since this was
            refreshed, and closed issues aren&apos;t in the cached data — refresh
            to apply it.
          </span>
        </div>
      )}

      {stale && data && !scopeChanged && (
        <div className="flex items-start gap-2 rounded-md border border-attention/40 bg-attention/10 px-3 py-2 text-xs text-fg">
          <span className="mt-0.5 text-attention">
            <ClockIcon size={16} />
          </span>
          <span>
            This data was fetched {describeAge(snapshot?.refreshedAt)}. Issues
            may have changed in GitHub since — refresh to bring them up to date.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
          Nothing cached yet — press Refresh to run this project&apos;s first
          scan.
        </div>
      )}

      {result && tree && <AuditView result={result} tree={tree} />}
    </div>
  );
}
