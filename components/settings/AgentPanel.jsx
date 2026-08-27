"use client";
import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { COPILOT_MODELS, DEFAULT_COPILOT_MODEL } from "@/lib/copilot";
import { Panel } from "./primitives";

// Project-level agent settings.
//
// Only enablement and model choice live here. The CREDENTIAL is per-user and is
// connected under user settings, because a Copilot seat is licensed to a person
// — a project admin enabling the agent does not lend anyone their subscription.
export default function AgentPanel({ project, patch, canAdmin }) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(!!project.agentEnabled);
  const [model, setModel] = useState(project.agentModel || DEFAULT_COPILOT_MODEL);
  const [busy, setBusy] = useState(false);

  useEffect(() => setEnabled(!!project.agentEnabled), [project.agentEnabled]);
  useEffect(
    () => setModel(project.agentModel || DEFAULT_COPILOT_MODEL),
    [project.agentModel]
  );

  const dirty =
    enabled !== !!project.agentEnabled ||
    model !== (project.agentModel || DEFAULT_COPILOT_MODEL);

  async function save() {
    setBusy(true);
    try {
      await patch({ agentEnabled: enabled, agentModel: model });
      toast.success(enabled ? "Agent enabled." : "Agent disabled.");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Agent"
      blurb="Adds an Agent tab to this project. Each member uses their own GitHub Copilot subscription, connected under their own settings — enabling this does not share yours."
    >
      <fieldset disabled={!canAdmin} className="max-w-md space-y-4">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-1"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>
            <span className="text-sm text-fg">Enable the agent</span>
            <span className="mt-0.5 block text-xs text-muted">
              Members without a connected Copilot account are prompted to connect
              one.
            </span>
          </span>
        </label>

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-muted">Model</label>
          <select
            className="gh-input w-full px-2.5 py-1.5 text-sm disabled:opacity-60"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {COPILOT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted">
            Availability depends on each member&apos;s Copilot plan.
          </p>
        </div>

        {canAdmin && (
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={!dirty || busy}
              className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {dirty && <span className="text-xs text-muted">Unsaved changes</span>}
          </div>
        )}
      </fieldset>
    </Panel>
  );
}
