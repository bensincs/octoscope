"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LinkExternalIcon, CopyIcon, CheckCircleIcon } from "@primer/octicons-react";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/projectForms";
import { Panel } from "./primitives";

// Connects the signed-in user's own GitHub Copilot account.
//
// This lives in USER settings rather than project settings because a Copilot
// seat is licensed to a person. Projects decide whether an agent is available
// and which model it uses; the credential behind it is always the caller's own,
// so one person's subscription is never spent on behalf of a team.
export default function CopilotPanel() {
  const toast = useToast();
  const [cred, setCred] = useState(null); // null = loading
  const [flow, setFlow] = useState(null); // in-progress device flow
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/credential");
      setCred(await res.json());
    } catch {
      setCred({ configured: false, connected: false });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Stop polling if the panel unmounts mid sign-in.
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function connect() {
    setBusy(true);
    try {
      const res = await fetch("/api/agent/connect", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start sign-in");
      setFlow(data);

      const startedAt = Date.now();
      const tick = async () => {
        if (cancelled.current) return;
        if (Date.now() - startedAt > 15 * 60_000) {
          setFlow(null);
          toast.error("Sign-in timed out. Try again.");
          return;
        }
        const r = await fetch("/api/agent/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode: data.deviceCode }),
        });
        const j = await r.json().catch(() => ({}));
        if (cancelled.current) return;

        if (!r.ok) {
          setFlow(null);
          toast.error(j.error || "Sign-in failed");
          return;
        }
        if (j.status === "complete") {
          setFlow(null);
          await load();
          toast.success(`Connected as ${j.accountLogin ?? "your account"}.`);
          return;
        }
        if (j.status === "expired") {
          setFlow(null);
          toast.error("That code expired. Try again.");
          return;
        }
        setTimeout(tick, (j.interval ?? data.interval ?? 5) * 1000);
      };
      setTimeout(tick, (data.interval ?? 5) * 1000);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await fetch("/api/agent/credential", { method: "DELETE" });
    await load();
    toast.success("Disconnected.");
  }

  if (!cred) {
    return (
      <Panel title="GitHub Copilot">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="h-4 w-4" />
          Checking…
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="GitHub Copilot"
      blurb="Powers the Agent tab on projects that enable it. The connection is yours alone — your token is stored encrypted, is never shown to anyone, and no other member can use it."
    >
      {!cred.configured ? (
        <div className="rounded-md border border-attention/40 bg-attention/10 px-3 py-2 text-xs text-fg">
          Copilot isn&apos;t configured on this deployment. An operator needs to
          set{" "}
          <code className="rounded bg-subtle px-1 py-0.5 font-mono">
            COPILOT_CLIENT_ID
          </code>{" "}
          before anyone can connect.
        </div>
      ) : cred.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-success">
              <CheckCircleIcon size={16} />
            </span>
            <span className="text-fg">
              Connected
              {cred.accountLogin && (
                <span className="text-muted"> as {cred.accountLogin}</span>
              )}
            </span>
          </div>
          <button onClick={disconnect} className="btn px-2.5 py-1 text-xs">
            Disconnect
          </button>
        </div>
      ) : flow ? (
        <div className="space-y-3 rounded-md border border-border px-3 py-3">
          <p className="text-sm text-fg">
            Enter this code on GitHub to finish signing in:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md border border-border bg-subtle px-3 py-2 font-mono text-lg tracking-widest text-fg">
              {flow.userCode}
            </code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(flow.userCode);
                toast.success("Code copied.");
              }}
              aria-label="Copy code"
              className="btn px-2.5 py-2 text-xs"
            >
              <CopyIcon size={14} />
            </button>
            <a
              href={flow.verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
            >
              <LinkExternalIcon size={14} />
              Open GitHub
            </a>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted">
            <Spinner className="h-3 w-3" />
            Waiting for you to approve…
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            onClick={connect}
            disabled={busy}
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? "Starting…" : "Connect GitHub Copilot"}
          </button>
          <p className="text-[11px] text-muted">
            Requires an active Copilot subscription on your GitHub account.
          </p>
        </div>
      )}
    </Panel>
  );
}
