"use client";
import { useState } from "react";
import { XIcon } from "@primer/octicons-react";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import Modal from "@/components/Modal";
import { Panel, ListBox } from "./primitives";

// Defines the environments members can claim. Editor-level, matching repos and
// boards — this is project configuration. Claiming them is viewer-level and
// happens on the Environments tab, not here.
export default function EnvironmentsPanel({ project, onChanged, canEdit }) {
  const toast = useToast();
  const confirm = useConfirm();
  const environments = project.environments ?? [];

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/environments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.fields?.[0]?.message || data.error || "Failed to add");
      }
      await onChanged?.();
      toast.success(`Added ${data.name}.`);
      setAdding(false);
      setName("");
      setDescription("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(env) {
    const ok = await confirm({
      title: "Remove environment?",
      body: env.claim
        ? `“${env.name}” is currently claimed by ${env.claim.login}. Removing it will release their claim.`
        : `“${env.name}” will be removed from this project.`,
      confirmLabel: "Remove environment",
    });
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/projects/${project.id}/environments/${env.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove environment");
      }
      await onChanged?.();
      toast.success(`Removed ${env.name}.`);
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <Panel
      title="Environments"
      blurb="Named environments members can claim to signal they're using them. Add at least one to show the Environments tab."
      action={
        canEdit && (
          <button
            onClick={() => {
              setAdding(true);
              setError(null);
            }}
            className="btn-primary px-2.5 py-1 text-xs"
          >
            Add environment
          </button>
        )
      }
    >
      <ListBox empty="No environments yet.">
        {environments.map((env) => (
          <div
            key={env.id}
            className="flex items-start justify-between gap-3 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">{env.name}</p>
              {env.description && (
                <p className="mt-0.5 text-xs text-muted">{env.description}</p>
              )}
              <p className="mt-0.5 text-[11px] text-muted">
                {env.claim
                  ? `Claimed by ${env.claim.login}`
                  : "Available"}
              </p>
            </div>
            {canEdit && (
              <button
                onClick={() => remove(env)}
                aria-label={`Remove ${env.name}`}
                className="rounded p-1 text-muted hover:text-danger"
              >
                <XIcon size={16} />
              </button>
            )}
          </div>
        ))}
      </ListBox>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add environment">
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-muted">Name</label>
            <input
              data-autofocus
              className="gh-input w-full px-2.5 py-1.5 text-sm"
              placeholder="staging"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-muted">
              Description <span className="font-normal">(optional)</span>
            </label>
            <input
              className="gh-input w-full px-2.5 py-1.5 text-sm"
              placeholder="Shared pre-production environment"
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {error && <p className="text-[11px] text-danger">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setAdding(false)} className="btn px-3 py-1.5 text-sm">
              Cancel
            </button>
            <button
              onClick={add}
              disabled={!name.trim() || busy}
              className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </Modal>
    </Panel>
  );
}
