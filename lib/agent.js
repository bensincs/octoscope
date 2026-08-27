// OpenAI-compatible chat backend for the project agent.
//
// Deliberately provider-agnostic rather than tied to one vendor: any endpoint
// speaking the OpenAI /chat/completions shape works — OpenAI itself, Azure
// OpenAI, Anthropic-compatible gateways, or a local model. That is the whole
// point of "bring your own LLM", and it avoids depending on any single
// provider's availability or terms.
//
// Credentials are per PROJECT here, unlike a Copilot seat: an API key is
// billed by usage rather than licensed to a person, so an admin configuring one
// for their team is a normal arrangement rather than redistribution.

export class AgentError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "AgentError";
    this.status = status;
  }
}

/** Trim a base URL to a bare origin+path, so callers can be relaxed about slashes. */
export function normalizeBaseUrl(url) {
  return String(url ?? "")
    .trim()
    .replace(/\/+$/, "");
}

/**
 * Validate agent connection settings.
 *
 * Only http(s) is accepted: the base URL is used server-side, so allowing an
 * arbitrary scheme would let a project admin point the server at something that
 * isn't an HTTP service at all.
 */
export function validateAgentSettings({ baseUrl, model } = {}) {
  const errors = [];

  if (baseUrl !== undefined) {
    const clean = normalizeBaseUrl(baseUrl);
    if (clean) {
      let parsed;
      try {
        parsed = new URL(clean);
      } catch {
        parsed = null;
      }
      if (!parsed || !/^https?:$/.test(parsed.protocol)) {
        errors.push({
          field: "baseUrl",
          message: "Enter a full http(s) URL, e.g. https://api.openai.com/v1",
        });
      }
    }
  }

  if (model !== undefined && String(model ?? "").trim().length > 200) {
    errors.push({ field: "model", message: "Model name is too long." });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Stream a chat completion.
 *
 * Returns the upstream Response so the route can pipe it through unbuffered —
 * the point of streaming is that the first token reaches the browser
 * immediately rather than after the whole reply is assembled.
 */
export async function streamChat({ baseUrl, apiKey, model, messages, signal }) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new AgentError("No endpoint configured.", { status: 400 });
  if (!apiKey) throw new AgentError("No API key configured.", { status: 400 });

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      // Bearer suits OpenAI and most compatible gateways; Azure OpenAI also
      // accepts it alongside api-key, so both are sent.
      Authorization: `Bearer ${apiKey}`,
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // Never echo the key back, and keep the upstream body short: it can contain
    // request context a project member has no business seeing.
    throw new AgentError(
      `The model endpoint rejected the request (${res.status}). ${detail.slice(0, 200)}`,
      { status: res.status === 401 || res.status === 403 ? 502 : res.status },
    );
  }
  return res;
}

export { SUGGESTED_MODELS, DEFAULT_MODEL } from "./agentModels.js";
