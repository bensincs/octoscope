"use client";
import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { SUGGESTED_MODELS, DEFAULT_MODEL } from "@/lib/agentModels";
import { Panel } from "./primitives";

// Connection settings for the project agent.
//
// Admin-only: this holds a billable API key that every member of the project
// will spend, which is the same bar as deciding who those members are.
export default function AgentPanel({ project, patch, canAdmin }) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(!!project.agentEnabled);
  const [baseUrl, setBaseUrl] = useState(project.agentBaseUrl || "");
  const [model, setModel] = useState(project.agentModel || DEFAULT_MODEL);
  // The stored key is never sent to the browser, so this starts empty and an
  // empty value means "leave it alone" rather than "clear it".
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => setEnabled(!!project.agentEnabled), [project.agentEnabled]);
  useEffect(() => setBaseUrl(project.agentBaseUrl || ""), [project.agentBaseUrl]);
  useEffect(
    () => setModel(project.agentModel || DEFAULT_MODEL),
    [project.agentModel]
  );

  const dirty =
    enabled !== !!project.agentEnabled ||
    baseUrl !== (project.agentBaseUrl || "") ||
    model !== (project.agentModel || DEFAULT_MODEL) ||
    apiKey.length > 0;

  // Enabling with nothing behind it would show a tab that can only error.
  const incomplete =
    enabled && (!baseUrl.trim() || (!project.agentHasApiKey && !apiKey.trim()));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await patch({
        agentEnabled: enabled,
        agentBaseUrl: baseUrl,
        agentModel: model,
        // Only send the key when one was typed, so saving other fields cannot
        // wipe it.
        ...(apiKey.trim() ? { agentApiKey: apiKey.trim() } : {}),
      });
      setApiKey("");
      toast.success("Agent settings saved.");
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    setBusy(true);
    try {
      await patch({ agentApiKey: "" });
      setApiKey("");
      toast.success("API key removed.");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Agent"
      blurb="Adds an Agent tab backed by any OpenAI-compatible endpoint — OpenAI, Azure OpenAI, or anything else speaking the same API. The key is shared by everyone in the project, so its usage is billed to you."
    >
      <fieldset disabled={!canAdmin} className="max-w-lg space-y-4">
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
              Shows the Agent tab to everyone who can open this project.
            </span>
          </span>
        </label>

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-muted">Endpoint</label>
          <input
            className="gh-input w-full px-2.5 py-1.5 font-mono text-sm disabled:opacity-60"
            placeholder="https://api.openai.com/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="text-[11px] text-muted">
            Base URL only — <code>/chat/completions</code> is appended. For Azure
            OpenAI use{" "}
            <code>https://&lt;resource&gt;.openai.azure.com/openai/deployments/&lt;deployment&gt;</code>
            .
          </p>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-muted">Model</label>
          <input
            list="agent-model-suggestions"
            className="gh-input w-full px-2.5 py-1.5 font-mono text-sm disabled:opacity-60"
            placeholder={DEFAULT_MODEL}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <datalist id="agent-model-suggestions">
            {SUGGESTED_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <p className="text-[11px] text-muted">
            Any model your endpoint accepts. Suggestions are not a restriction.
          </p>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-semibold text-muted">API key</label>
          <input
            type="password"
            autoComplete="off"
            className="gh-input w-full px-2.5 py-1.5 font-mono text-sm disabled:opacity-60"
            placeholder={
              project.agentHasApiKey ? "•••••••• (leave blank to keep)" : "sk-…"
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="text-[11px] text-muted">
            Stored encrypted and never shown again — members can use the agent
            without ever seeing it.
            {project.agentHasApiKey && canAdmin && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={clearKey}
                  className="text-danger hover:underline"
                >
                  Remove the stored key
                </button>
              </>
            )}
          </p>
        </div>

        {incomplete && (
          <p className="text-[11px] text-attention">
            Set an endpoint and an API key, or the Agent tab will only be able to
            show errors.
          </p>
        )}
        {error && <p className="text-[11px] text-danger">{error}</p>}

        {canAdmin && (
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={!dirty || busy || incomplete}
              className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {dirty && !incomplete && (
              <span className="text-xs text-muted">Unsaved changes</span>
            )}
          </div>
        )}
      </fieldset>
    </Panel>
  );
}
