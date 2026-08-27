"use client";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";

export default function DangerPanel({ project, onDeleted, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState(null);
  const [target, setTarget] = useState("");
  const [transferring, setTransferring] = useState(false);

  // Only members who have actually signed in can own a project: ownership is a
  // user id, and a pending invite has none.
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/collaborators`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load members");
      setMembers(
        (data.collaborators ?? []).filter((c) => !c.pending && c.role !== "owner")
      );
    } catch {
      setMembers([]);
    }
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function transfer() {
    const member = members?.find((m) => m.id === target);
    if (!member) return;
    const ok = await confirm({
      title: "Transfer ownership?",
      body: `${member.login} will become the owner of “${project.name}”. You will be demoted to admin and will no longer be able to delete the project or transfer it again.`,
      confirmLabel: `Make ${member.login} the owner`,
    });
    if (!ok) return;
    setTransferring(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/transfer-ownership`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collaboratorId: target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.fields?.[0]?.message || data.error || "Transfer failed");
      }
      toast.success(`${member.login} now owns this project.`);
      await onChanged?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setTransferring(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this project?",
      body: `“${project.name}” and its rulebook, repositories and boards (including stored PATs) will be permanently removed. This cannot be undone.`,
      confirmLabel: "Delete this project",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      toast.success(`Deleted ${project.name}.`);
      onDeleted?.();
    } catch (e) {
      toast.error(e.message);
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="border-b border-danger/40 pb-2 text-xl font-normal text-danger">
        Danger zone
      </h2>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/40 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">Transfer ownership</p>
          <p className="mt-0.5 text-xs text-muted">
            Hand this project to another member. You keep access as an admin,
            but lose the ability to delete or transfer it.
          </p>
          {members?.length === 0 && (
            <p className="mt-1 text-xs text-muted">
              No eligible members — someone must be a member and have signed in
              at least once.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={!members?.length}
            className="gh-input px-2.5 py-1.5 text-sm disabled:opacity-50"
          >
            <option value="">Choose a member…</option>
            {(members ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.login}
              </option>
            ))}
          </select>
          <button
            onClick={transfer}
            disabled={!target || transferring}
            className="rounded-md border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {transferring ? "Transferring…" : "Transfer"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/40 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">Delete this project</p>
          <p className="mt-0.5 text-xs text-muted">
            Removes its rulebook, repositories and boards (including their stored
            PATs). This cannot be undone.
          </p>
        </div>
        <button
          onClick={remove}
          disabled={busy}
          className="shrink-0 rounded-md border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete this project"}
        </button>
      </div>
    </section>
  );
}
