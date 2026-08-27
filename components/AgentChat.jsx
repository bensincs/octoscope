"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PaperAirplaneIcon, TrashIcon } from "@primer/octicons-react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/projectForms";
import Markdown from "@/components/Markdown";

// Chat surface for the project agent.
//
// Conversations are EPHEMERAL — held in component state and gone on reload.
// Nothing is written to the database, so there is no question of who can read
// whose messages, and no retention policy to get wrong.
export default function AgentChat({ projectId, project }) {
  const router = useRouter();
  const toast = useToast();
  const [cred, setCred] = useState(null); // null = loading
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const abortRef = useRef(null);

  const loadCred = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/credential");
      setCred(await res.json());
    } catch {
      setCred({ configured: false, connected: false });
    }
  }, []);

  useEffect(() => {
    loadCred();
  }, [loadCred]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Stop polling if the user navigates away mid sign-in.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function disconnect() {
    await fetch("/api/agent/credential", { method: "DELETE" });
    await loadCred();
    toast.success("Disconnected.");
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const next = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/projects/${projectId}/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }

      // Copilot streams OpenAI-style SSE: "data: {json}" lines, ending in
      // "data: [DONE]". Parsed incrementally so text appears as it arrives.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reply = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
            if (delta) {
              reply += delta;
              setMessages((m) => {
                const copy = [...m];
                copy[copy.length - 1] = { role: "assistant", content: reply };
                return copy;
              });
            }
          } catch {
            // A partial chunk mid-JSON is normal; the next read completes it.
          }
        }
      }

      if (!reply) {
        setMessages((m) => m.slice(0, -1));
        toast.error("The model returned nothing.");
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        setMessages((m) => m.slice(0, -1));
        toast.error(e.message);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  if (!cred) {
    return (
      <div className="flex items-center justify-center py-16 text-muted">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  if (!cred.configured) {
    return (
      <div className="rounded-md border border-attention/40 bg-attention/10 px-4 py-3 text-sm text-fg">
        Copilot isn&apos;t configured on this deployment. An operator needs to set{" "}
        <code className="rounded bg-subtle px-1 py-0.5 font-mono text-xs">
          COPILOT_CLIENT_ID
        </code>
        .
      </div>
    );
  }

  if (!cred.connected) {
    // The credential is per-user, so it is configured in USER settings rather
    // than here — otherwise every project would offer its own copy of the same
    // account-level connection.
    return (
      <div className="max-w-lg space-y-3">
        <h1 className="text-xl font-normal text-fg">Agent</h1>
        <p className="text-sm text-muted">
          The agent uses <strong className="text-fg">your own</strong> GitHub
          Copilot subscription, so nobody else&apos;s seat is spent on your
          behalf. Connect it once and it works across every project.
        </p>
        <button
          onClick={() => router.push("/settings")}
          className="btn-primary px-3 py-1.5 text-sm"
        >
          Connect Copilot in settings
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-13rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-normal text-fg">Agent</h1>
          <p className="mt-0.5 text-xs text-muted">
            {project.agentModel || "default model"} · your Copilot account
            {cred.accountLogin && ` (${cred.accountLogin})`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="btn inline-flex items-center gap-1.5 px-2.5 py-1 text-xs"
            >
              <TrashIcon size={14} />
              Clear
            </button>
          )}
          <button onClick={disconnect} className="btn px-2.5 py-1 text-xs">
            Disconnect
          </button>
        </div>
      </div>

      <div className="gh-card flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">
            Ask anything. Conversations aren&apos;t saved — reloading clears them.
          </p>
        ) : (
          <div className="space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : ""}>
                <div
                  className={
                    m.role === "user"
                      ? "inline-block max-w-[80%] rounded-lg bg-subtle px-3 py-2 text-left text-sm text-fg"
                      : "max-w-none text-sm text-fg"
                  }
                >
                  {m.role === "user" ? (
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  ) : m.content ? (
                    <Markdown>{m.content}</Markdown>
                  ) : (
                    <Spinner className="h-4 w-4" />
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask the agent… (Enter to send, Shift+Enter for a new line)"
          className="gh-input flex-1 resize-none px-3 py-2 text-sm"
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm disabled:opacity-50"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <PaperAirplaneIcon size={16} />}
          Send
        </button>
      </div>
    </div>
  );
}
