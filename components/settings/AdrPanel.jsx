"use client";
import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { normalizeAdrPath } from "@/lib/adrs";
import { Panel } from "./primitives";

// Chooses which connected repository holds the project's decision records, and
// the folder within it. Both are required before the Decisions tab appears —
// a repo with no path is as unusable as a path with no repo.
export default function AdrPanel({ project, patch, canEdit }) {
  const toast = useToast();
  const repos = project.repos ?? [];

  const [repoId, setRepoId] = useState(project.adrRepoId ?? "");
  const [path, setPath] = useState(project.adrPath ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => setRepoId(project.adrRepoId ?? ""), [project.adrRepoId]);
  useEffect(() => setPath(project.adrPath ?? ""), [project.adrPath]);

  const cleanPath = normalizeAdrPath(path);
  const dirty =
    (repoId || null) !== (project.adrRepoId ?? null) ||
    (cleanPath || null) !== (project.adrPath ?? null);

  // Half-configured is worse than unconfigured: it would show a tab that can
  // never load. Allow only "both set" or "both cleared".
  const partial = (!!repoId && !cleanPath) || (!repoId && !!cleanPath);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await patch({ adrRepoId: repoId || "", adrPath: cleanPath });
      toast.success(
        repoId && cleanPath ? "Decision records configured." : "Decision records cleared."
      );
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Decision records"
      blurb="Architecture Decision Records are read from a folder in one of this project's repositories. The Decisions tab appears once both are set."
    >
      {repos.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          Connect a repository first — decision records are read from one.
        </div>
      ) : (
        <fieldset disabled={!canEdit} className="max-w-md space-y-4">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-muted">
              Repository
            </label>
            <select
              className="gh-input w-full px-2.5 py-1.5 text-sm disabled:opacity-60"
              value={repoId}
              onChange={(e) => setRepoId(e.target.value)}
            >
              <option value="">None</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nameWithOwner}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-muted">Folder</label>
            <input
              className="gh-input w-full px-2.5 py-1.5 font-mono text-sm disabled:opacity-60"
              placeholder="docs/adr"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <p className="text-[11px] text-muted">
              Path from the repository root. Markdown files in this folder are
              read on refresh; other file types are ignored.
            </p>
          </div>

          {partial && (
            <p className="text-[11px] text-attention">
              Set both a repository and a folder, or clear both.
            </p>
          )}
          {error && <p className="text-[11px] text-danger">{error}</p>}

          {canEdit && (
            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={!dirty || partial || busy}
                className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              {dirty && !partial && (
                <span className="text-xs text-muted">Unsaved changes</span>
              )}
            </div>
          )}
        </fieldset>
      )}
    </Panel>
  );
}
