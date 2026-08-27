"use client";
import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import Markdown from "@/components/Markdown";
import { Panel } from "./primitives";

// Authoring surface for the project's welcome page.
//
// Requires `admin` (canAdmin), not `editor`: the welcome page is shown to
// everyone who can open the project, so writing it is the same bar as deciding
// who those people are. Clearing the text hides the Welcome tab again.
export default function WelcomePanel({ project, patch, canAdmin }) {
  const toast = useToast();
  const initial = project.welcomeMarkdown ?? "";
  const [body, setBody] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => setBody(project.welcomeMarkdown ?? ""), [project.welcomeMarkdown]);

  const dirty = body !== initial;
  const willHide = initial.trim() && !body.trim();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await patch({ welcomeMarkdown: body });
      toast.success(
        body.trim() ? "Welcome page saved." : "Welcome page cleared."
      );
    } catch (e) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Welcome"
      blurb="An optional markdown page shown to everyone who opens this project. While it's empty the Welcome tab stays hidden."
      action={
        <button
          onClick={() => setPreview((p) => !p)}
          className="btn px-2.5 py-1 text-xs"
        >
          {preview ? "Edit" : "Preview"}
        </button>
      }
    >
      <fieldset disabled={!canAdmin} className="space-y-3">
        {preview ? (
          <div className="min-h-[16rem] rounded-md border border-border px-4 py-3">
            {body.trim() ? (
              <Markdown>{body}</Markdown>
            ) : (
              <p className="text-sm text-muted">Nothing to preview yet.</p>
            )}
          </div>
        ) : (
          <textarea
            className="gh-input min-h-[16rem] w-full px-2.5 py-1.5 font-mono text-xs disabled:opacity-60"
            placeholder={"# Welcome\n\nWhat this project is, who to ask, how to get started."}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}

        {error && <p className="text-[11px] text-danger">{error}</p>}

        {canAdmin && (
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={!dirty || busy}
              className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {willHide && (
              <span className="text-[11px] text-muted">
                Saving an empty page removes the Welcome tab.
              </span>
            )}
          </div>
        )}
      </fieldset>
    </Panel>
  );
}
