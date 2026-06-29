"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";

export default function DangerPanel({ project, onDeleted }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

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
