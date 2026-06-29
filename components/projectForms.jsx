"use client";
// Shared building blocks for working with a saved audit project's repos and
// boards. Used by the project settings page (ProjectSettings).
import { useEffect, useState } from "react";
import { XIcon } from "@primer/octicons-react";
import Combobox from "@/components/Combobox";

export function Spinner({ className = "" }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-border border-t-accent ${className}`}
    />
  );
}

// Load the signed-in user's owners (self + orgs) via the OAuth session token.
// This powers the browse-and-pick affordance; it degrades gracefully — any
// failure just leaves the picker hidden and manual entry available.
export function useOwners() {
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/github/owners");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load owners");
        if (alive) setOwners(data.owners || []);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return { owners, loading, error };
}

// Small inline "replace PAT" control shared by repo + board rows.
export function ReplacePat({ endpoint, onDone }) {
  const [open, setOpen] = useState(false);
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.fields?.[0]?.message || data.error || "Failed");
      setOpen(false);
      setPat("");
      onDone?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded p-0.5 text-muted hover:text-fg"
        title="Replace PAT"
        aria-label="Replace PAT"
      >
        ⟳
      </button>
    );
  }

  return (
    <div className="flex w-full items-center gap-1.5">
      <input
        type="password"
        autoComplete="off"
        className="gh-input min-w-0 flex-1 px-2 py-1 text-xs font-mono"
        placeholder="New PAT…"
        value={pat}
        onChange={(e) => setPat(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && pat.trim() && save()}
      />
      <button
        onClick={save}
        disabled={busy || !pat.trim()}
        className="btn-primary px-2 py-1 text-[11px] disabled:opacity-50"
      >
        {busy ? "…" : "Save"}
      </button>
      <button
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="rounded px-1 py-1 text-muted hover:text-fg"
        aria-label="Cancel"
      >
        <XIcon size={14} />
      </button>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  );
}

// Add a repository (with its own PAT) to an existing project. Calls
// onAdded(repo) with the created, masked repo view on success.
export function AddRepoForm({ projectId, owners, onAdded, submitLabel = "Add repository" }) {
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Browse state — repos for the chosen owner power the repo type-ahead.
  const [repos, setRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);

  // Load the chosen owner's repos for autocomplete (best-effort).
  useEffect(() => {
    if (!owner.trim()) {
      setRepos([]);
      return;
    }
    let alive = true;
    setReposLoading(true);
    fetch(`/api/github/repos?login=${encodeURIComponent(owner.trim())}`)
      .then((r) => r.json())
      .then((d) => alive && setRepos(d.repos || []))
      .catch(() => alive && setRepos([]))
      .finally(() => alive && setReposLoading(false));
    return () => {
      alive = false;
    };
  }, [owner]);

  const ownerOptions = owners.owners.map((o) => ({
    value: o.login,
    label: o.login,
    hint: o.type === "org" ? "org" : "you",
  }));
  const repoOptions = repos.map((r) => ({
    value: r.name,
    label: r.name,
    hint: r.isPrivate ? "private" : undefined,
  }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/repos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, name, pat }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.fields?.[0]?.message || data.error || "Failed");
      setOwner("");
      setName("");
      setPat("");
      onAdded(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-muted">Owner</label>
          <Combobox
            value={owner}
            onChange={(v) => {
              setOwner(v);
              setName("");
            }}
            options={ownerOptions}
            loading={owners.loading}
            placeholder="Search owner…"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-muted">Repository</label>
          <Combobox
            value={name}
            onChange={setName}
            options={repoOptions}
            loading={reposLoading}
            placeholder="Search repo…"
            emptyText={owner.trim() ? "No matches" : "Pick an owner first"}
          />
        </div>
      </div>

      <input
        type="password"
        autoComplete="off"
        className="gh-input w-full px-2.5 py-1.5 text-sm font-mono"
        placeholder="PAT (ghp_… or github_pat_…)"
        value={pat}
        onChange={(e) => setPat(e.target.value)}
      />
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="btn-primary w-full px-2.5 py-1.5 text-sm disabled:opacity-50"
      >
        {busy ? "Adding…" : submitLabel}
      </button>
    </form>
  );
}

// Add a Projects v2 board (with its own PAT) to an existing project. Calls
// onAdded(board) with the created, masked board view on success.
export function AddBoardForm({ projectId, owners, onAdded, submitLabel = "Add board" }) {
  const [ownerLogin, setOwnerLogin] = useState("");
  const [projectNumber, setProjectNumber] = useState("");
  const [title, setTitle] = useState("");
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Browse state — Projects v2 for the chosen owner power the project type-ahead.
  const [boards, setBoards] = useState([]);
  const [boardsLoading, setBoardsLoading] = useState(false);

  // Load Projects v2 for the picked owner.
  useEffect(() => {
    if (!ownerLogin.trim()) {
      setBoards([]);
      return;
    }
    let alive = true;
    setBoardsLoading(true);
    fetch(`/api/github/projects?login=${encodeURIComponent(ownerLogin.trim())}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setBoards(d.projects || []);
      })
      .catch(() => alive && setBoards([]))
      .finally(() => alive && setBoardsLoading(false));
    return () => {
      alive = false;
    };
  }, [ownerLogin]);

  const ownerOptions = owners.owners.map((o) => ({
    value: o.login,
    label: o.login,
    hint: o.type === "org" ? "org" : "you",
  }));
  const boardOptions = boards.map((b) => ({
    value: String(b.number),
    label: `#${b.number} · ${b.title}`,
    title: b.title,
  }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/boards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerLogin,
          projectNumber: Number(projectNumber),
          title,
          pat,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.fields?.[0]?.message || data.error || "Failed");
      setOwnerLogin("");
      setProjectNumber("");
      setTitle("");
      setPat("");
      onAdded(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-muted">Owner</label>
          <Combobox
            value={ownerLogin}
            onChange={(v) => {
              setOwnerLogin(v);
              setProjectNumber("");
              setTitle("");
            }}
            options={ownerOptions}
            loading={owners.loading}
            placeholder="Search owner…"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-muted">Project</label>
          <Combobox
            value={projectNumber}
            onChange={setProjectNumber}
            onSelect={(o) => setTitle(o.title || "")}
            options={boardOptions}
            loading={boardsLoading}
            placeholder="Search project…"
            emptyText={ownerLogin.trim() ? "No matches" : "Pick an owner first"}
          />
        </div>
      </div>

      <input
        className="gh-input w-full px-2.5 py-1.5 text-sm"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        type="password"
        autoComplete="off"
        className="gh-input w-full px-2.5 py-1.5 text-sm font-mono"
        placeholder="PAT with read:project"
        value={pat}
        onChange={(e) => setPat(e.target.value)}
      />
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="btn-primary w-full px-2.5 py-1.5 text-sm disabled:opacity-50"
      >
        {busy ? "Adding…" : submitLabel}
      </button>
    </form>
  );
}
