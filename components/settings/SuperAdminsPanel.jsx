"use client";
import { useCallback, useEffect, useState } from "react";
import Combobox from "@/components/Combobox";
import Modal from "@/components/Modal";
import { XIcon } from "@primer/octicons-react";
import { Spinner } from "@/components/projectForms";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import { Panel, ListBox } from "./primitives";

export default function SuperAdminsPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/super-admins");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load super admins");
      setList(data.superAdmins);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(member) {
    const ok = await confirm({
      title: "Revoke super admin?",
      body: `${member.login || "This person"} will lose owner-level access to every audit project.`,
      confirmLabel: "Revoke access",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/admin/super-admins/${member.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.fields?.[0]?.message || data.error || "Failed to revoke");
      }
      await load();
      toast.success(`Revoked ${member.login || "super admin"}.`);
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <Panel
      title="Super admins"
      blurb="Platform operators with owner-level access to every audit project — including ones they don't own or collaborate on. Grant this sparingly."
      action={
        <button
          onClick={() => setAdding(true)}
          className="btn-primary shrink-0 px-3 py-1.5 text-sm"
        >
          Add super admin
        </button>
      }
    >
      {error && <p className="mb-2 text-[11px] text-danger">{error}</p>}
      {list === null ? (
        <div className="flex items-center justify-center py-8 text-muted">
          <Spinner className="h-4 w-4" />
        </div>
      ) : (
        <ListBox empty="No super admins yet.">
          {list.map((m) => (
            <AdminRow key={m.id} member={m} onRemove={remove} />
          ))}
        </ListBox>
      )}
      <p className="mt-3 text-[11px] text-muted">
        Granted users get access on their next GitHub sign-in. You can't revoke
        your own access.
      </p>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a super admin">
        <AddSuperAdminForm
          onAdded={(login) => {
            setAdding(false);
            load();
            toast.success(`${login} is now a super admin.`);
          }}
        />
      </Modal>
    </Panel>
  );
}

function AdminRow({ member, onRemove }) {
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
          title="Granted — gets access on their next sign-in"
        >
          pending
        </span>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {member.isSelf ? (
          <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
            You
          </span>
        ) : (
          <button
            onClick={() => onRemove(member)}
            className="rounded p-1 text-muted hover:text-danger"
            aria-label="Revoke super admin"
          >
            <XIcon size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// Remote GitHub user search, debounced, for the super-admin picker.
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

function AddSuperAdminForm({ onAdded }) {
  const [login, setLogin] = useState("");
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
      const res = await fetch("/api/admin/super-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: l }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.fields?.[0]?.message || data.error || "Failed to add super admin"
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
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <div className="flex justify-end">
        <button
          onClick={add}
          disabled={busy}
          className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add super admin"}
        </button>
      </div>
    </div>
  );
}
