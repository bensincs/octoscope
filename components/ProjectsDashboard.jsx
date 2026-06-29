"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_CONFIG } from "@/lib/hierarchy";
import { Spinner } from "@/components/projectForms";
import { useNav } from "@/components/NavContext";
import { useToast } from "@/components/Toast";
import { useSuperAdmin } from "@/components/SuperAdminContext";

export default function ProjectsDashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const { setBreadcrumb, setTabs } = useNav();
  const { superAdmin } = useSuperAdmin();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load projects");
      setProjects(data.projects);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // This is the home surface: clear any project breadcrumb and show the tabs.
  // Super admins also get a Settings tab next to Audit projects.
  useEffect(() => {
    setBreadcrumb([]);
    const tabs = [{ label: "Audit projects", active: true }];
    if (superAdmin) {
      tabs.push({ label: "Settings", onClick: () => router.push("/settings") });
    }
    setTabs(tabs);
    return () => setTabs([]);
  }, [setBreadcrumb, setTabs, superAdmin, router]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Saved configurations grouping repos and boards under one rulebook.
        </p>
        <button
          onClick={() => setCreating(true)}
          className="btn-primary shrink-0 px-3 py-1.5 text-sm"
        >
          + New project
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {creating && (
        <CreateProjectForm
          onCancel={() => setCreating(false)}
          onCreated={(id) => router.push(`/projects/${id}/settings`)}
        />
      )}

      <div className="mt-5 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted">
            <Spinner className="h-5 w-5" />
          </div>
        ) : projects.length === 0 ? (
          !creating && (
            <div className="gh-card grid place-items-center gap-3 px-6 py-16 text-center text-sm text-muted">
              <p>No audit projects yet.</p>
              <button
                onClick={() => setCreating(true)}
                className="btn-primary px-3 py-1.5 text-sm"
              >
                Create your first project
              </button>
            </div>
          )
        ) : (
          projects.map((p) => (
            <button
              key={p.id}
              onClick={() => router.push(`/projects/${p.id}`)}
              className="gh-card flex w-full items-center gap-3 px-4 py-3 text-left transition hover:border-accent"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-fg">{p.name}</span>
                  {p.role && p.role !== "owner" && (
                    <span className="shrink-0 rounded-full border border-border bg-subtle px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted">
                      {p.role}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {p.repoCount} repo{p.repoCount === 1 ? "" : "s"} ·{" "}
                  {p.boardCount} board{p.boardCount === 1 ? "" : "s"} ·{" "}
                  {(p.config?.levels?.length ?? 0)} levels
                </div>
              </div>
              <span className="ml-auto text-muted">→</span>
            </button>
          ))
        )}
      </div>
    </main>
  );
}

function CreateProjectForm({ onCancel, onCreated }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { error: toastError } = useToast();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the project a name to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, config: DEFAULT_CONFIG }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.fields?.[0]?.message || data.error || "Failed to create");
      }
      onCreated(data.id);
    } catch (e) {
      setError(e.message);
      toastError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="gh-card p-5">
      <h2 className="text-sm font-semibold text-fg">New audit project</h2>
      <p className="mt-0.5 text-xs text-muted">
        Just name it to start — you'll configure the rulebook, repositories and
        boards in settings next.
      </p>
      <div className="mt-3 max-w-md space-y-2">
        <input
          autoFocus
          className="gh-input w-full px-2.5 py-1.5 text-sm"
          placeholder="e.g. Platform — Q3 hygiene"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />
        {error && <p className="text-[11px] text-danger">{error}</p>}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? (
            <>
              <Spinner className="mr-1.5 h-3.5 w-3.5 align-[-2px]" /> Creating…
            </>
          ) : (
            "Create & configure"
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
