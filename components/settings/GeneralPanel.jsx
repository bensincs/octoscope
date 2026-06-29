"use client";
import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { Panel } from "./primitives";

export default function GeneralPanel({ project, patch, canEdit }) {
  const toast = useToast();
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => setName(project.name), [project.name]);

  const dirty = name.trim() !== project.name && name.trim().length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await patch({ name: name.trim() });
      toast.success("Project name saved.");
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="General" blurb="The display name for this saved audit configuration.">
      <fieldset disabled={!canEdit} className="max-w-md space-y-2">
        <label className="block text-xs font-semibold text-muted">Project name</label>
        <input
          className="gh-input w-full px-2.5 py-1.5 text-sm disabled:opacity-60"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && dirty && !busy && save()}
        />
        {error && <p className="text-[11px] text-danger">{error}</p>}
        {canEdit && (
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={save}
              disabled={!dirty || busy}
              className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </fieldset>
    </Panel>
  );
}
