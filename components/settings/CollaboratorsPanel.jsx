"use client";
import { useCallback, useEffect, useState } from "react";
import Combobox from "@/components/Combobox";
import Modal from "@/components/Modal";
import { XIcon } from "@primer/octicons-react";
import { Spinner } from "@/components/projectForms";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { Panel, ListBox, ResourceRow } from "./primitives";

export default function CollaboratorsPanel({ project, canAdmin }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/collaborators`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load collaborators");
      setList(data.collaborators);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeRole(member, role) {
    try {
      const res = await fetch(
        `/api/projects/${project.id}/collaborators/${member.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update role");
      }
      await load();
      toast.success(`${member.login || "Collaborator"} is now ${role}.`);
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function remove(member) {
    const ok = await confirm({
      title: "Remove collaborator?",
      body: `${member.login || "This person"} will lose access to this project.`,
      confirmLabel: "Remove collaborator",
    });
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/projects/${project.id}/collaborators/${member.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove");
      }
      await load();
      toast.success(`Removed ${member.login || "collaborator"}.`);
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <Panel
      title="Members"
      blurb="People who can access this audit project. The owner always keeps full access."
      action={
        canAdmin && (
          <button
            onClick={() => setAdding(true)}
            className="btn-primary shrink-0 px-3 py-1.5 text-sm"
          >
            Add collaborator
          </button>
        )
      }
    >
      {error && <p className="mb-2 text-[11px] text-danger">{error}</p>}
      {list === null ? (
        <div className="flex items-center justify-center py-8 text-muted">
          <Spinner className="h-4 w-4" />
        </div>
      ) : (
        <ListBox empty="No collaborators yet.">
          {list.map((m) => (
            <MemberRow
              key={m.id ?? "owner"}
              member={m}
              canAdmin={canAdmin}
              onRole={changeRole}
              onRemove={remove}
            />
          ))}
        </ListBox>
      )}
      {canAdmin && (
        <p className="mt-3 text-[11px] text-muted">
          Admins manage members; editors change the rulebook, repos and boards;
          viewers can run audits. Invited users get access on their next GitHub
          sign-in.
        </p>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a collaborator"
      >
        <AddCollaboratorForm
          projectId={project.id}
          onAdded={(login) => {
            setAdding(false);
            load();
            toast.success(`Invited ${login}.`);
          }}
        />
      </Modal>
    </Panel>
  );
}

function MemberRow({ member, canAdmin, onRole, onRemove }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm">
      {member.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={member.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
      ) : (
        <span className="grid h-6 w-6 place-items-center rounded-full bg-subtle text-[10px] uppercase text-muted">
          {(member.login || "?").slice(0, 2)}
        </span>
      )}
      <div className="min-w-0">
        <span className="truncate text-fg">{member.login || "Unknown"}</span>
        {member.name && (
          <span className="ml-1.5 text-[11px] text-muted">{member.name}</span>
        )}
      </div>
      {member.pending && (
        <span
          className="rounded-full border border-border px-1.5 text-[10px] text-muted"
          title="Invited — gets access on their next sign-in"
        >
          pending
        </span>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {member.isOwner ? (
          <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
            Owner
          </span>
        ) : canAdmin ? (
          <>
            <RoleSelect
              value={member.role}
              onChange={(role) => onRole(member, role)}
              className="px-1.5 py-1 text-xs"
            />
            <button
              onClick={() => onRemove(member)}
              className="rounded p-1 text-muted hover:text-danger"
              aria-label="Remove collaborator"
            >
              <XIcon size={14} />
            </button>
          </>
        ) : (
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] capitalize text-muted">
            {member.role}
          </span>
        )}
      </div>
    </div>
  );
}

function RoleSelect({ value, onChange, className = "" }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`gh-input ${className}`}
    >
      <option value="admin">Admin</option>
      <option value="editor">Editor</option>
      <option value="viewer">Viewer</option>
    </select>
  );
}

// Remote GitHub user search, debounced, for the collaborator picker.
function useUserSearch(query) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/github/users?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (alive) setResults(res.ok ? data.users || [] : []);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);
  return { results, loading };
}

function AddCollaboratorForm({ projectId, onAdded }) {
  const [login, setLogin] = useState("");
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { results, loading } = useUserSearch(login);
  const options = results.map((u) => ({
    value: u.login,
    label: u.login,
    hint: u.name && u.name !== u.login ? u.name : undefined,
  }));

  async function add() {
    const l = login.trim();
    if (!l) {
      setError("Enter a GitHub username.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: l, role }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.fields?.[0]?.message || data.error || "Failed to add collaborator"
        );
      onAdded?.(l);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <Combobox
            value={login}
            onChange={setLogin}
            onSelect={(o) => setLogin(o.value)}
            options={options}
            loading={loading}
            placeholder="Search GitHub username…"
            emptyText={
              login.trim()
                ? "No matches — you can still add this exact username"
                : "Type to search GitHub"
            }
          />
        </div>
        <RoleSelect value={role} onChange={setRole} className="px-2 py-1.5 text-sm" />
      </div>
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <div className="flex justify-end">
        <button
          onClick={add}
          disabled={busy}
          className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add collaborator"}
        </button>
      </div>
    </div>
  );
}
