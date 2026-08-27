"use client";
import { useEffect, useRef, useState } from "react";
import { PaperAirplaneIcon, TrashIcon } from "@primer/octicons-react";
import { useToast } from "@/components/Toast";
import { Spinner } from "@/components/projectForms";
import Markdown from "@/components/Markdown";

// Chat surface for the project agent.
//
// Conversations are EPHEMERAL — held in component state and gone on reload.
// Nothing is written to the database, so there is no question of who can read
// whose messages, and no retention policy to get wrong.
//
// The model connection belongs to the PROJECT and is decrypted server-side, so
// this component never handles an API key.
export default function AgentChat({ projectId, project }) {
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const abortRef = useRef(null);



  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Stop polling if the user navigates away mid sign-in.
  useEffect(() => () => abortRef.current?.abort(), []);


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


  return (
    <div className="flex h-[calc(100vh-13rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-normal text-fg">Agent</h1>
          <p className="mt-0.5 text-xs text-muted">
            {project.agentModel || "default model"}
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
