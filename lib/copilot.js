// GitHub Copilot as an LLM backend.
//
// ── Read this before changing anything here ──────────────────────────────────
//
// This talks to `api.github.com/copilot_internal/v2/token` and
// `api.githubcopilot.com`. Neither is a documented public API. They are what
// editor integrations use, and GitHub gates the token exchange on the OAuth
// client id belonging to a known editor.
//
// Two consequences, both deliberate:
//
//  1. The client id is NOT hardcoded. It comes from COPILOT_CLIENT_ID, so
//     whoever deploys this decides which OAuth application to present as,
//     rather than inheriting an editor's identity from a library author. With
//     it unset, the agent simply reports itself unavailable.
//
//  2. Credentials are per USER. A Copilot seat is licensed to a person, so
//     each member connects their own account; one admin's token is never
//     shared with a team.
//
// Being undocumented, this can break without notice. Everything here fails
// closed with a readable message rather than pretending the agent is fine.

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_API = "https://api.githubcopilot.com";

// Presented on every call. GitHub rejects the token exchange without them.
const EDITOR_HEADERS = {
  "Editor-Version": "Octoscope/1.0",
  "Editor-Plugin-Version": "octoscope/1.0",
  "Copilot-Integration-Id": "vscode-chat",
};

export function copilotClientId() {
  return process.env.COPILOT_CLIENT_ID || "";
}

export function isCopilotConfigured() {
  return !!copilotClientId();
}

class CopilotError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "CopilotError";
    this.status = status;
  }
}
export { CopilotError };

/** Begin the device flow. Returns the code the user types on github.com. */
export async function startDeviceFlow() {
  const clientId = copilotClientId();
  if (!clientId) {
    throw new CopilotError(
      "Copilot isn't configured on this deployment. Set COPILOT_CLIENT_ID.",
    );
  }

  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: "read:user" }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new CopilotError(`GitHub refused the device request (${res.status}).`);
  }

  const json = await res.json();
  if (json.error) throw new CopilotError(json.error_description || json.error);

  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    expiresIn: json.expires_in,
    interval: json.interval ?? 5,
  };
}

/**
 * Exchange a device code for an access token.
 *
 * `authorization_pending` is the normal state while the user is still typing
 * the code, so it is reported as a distinct, non-fatal outcome rather than an
 * error — the client polls on it.
 */
export async function pollDeviceFlow(deviceCode) {
  const clientId = copilotClientId();
  if (!clientId) throw new CopilotError("Copilot isn't configured.");

  const res = await fetch(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));

  if (json.access_token) return { status: "complete", token: json.access_token };
  if (json.error === "authorization_pending") return { status: "pending" };
  if (json.error === "slow_down") {
    return { status: "pending", interval: json.interval ?? 10 };
  }
  if (json.error === "expired_token") {
    return { status: "expired" };
  }
  throw new CopilotError(json.error_description || json.error || "Sign-in failed.");
}

/** Which GitHub account a token belongs to, for display and mismatch checks. */
export async function githubLoginForToken(token) {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return json.login ?? null;
}

// Copilot tokens last minutes, so they are cached in memory per process rather
// than written to the database on every request. A cold replica simply fetches
// a new one.
const tokenCache = new Map();

async function copilotToken(githubToken) {
  const cached = tokenCache.get(githubToken);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(COPILOT_TOKEN_URL, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/json",
      ...EDITOR_HEADERS,
    },
    cache: "no-store",
  });

  if (res.status === 401 || res.status === 403) {
    throw new CopilotError(
      "GitHub rejected this account for Copilot. Check the account has an active Copilot subscription, then reconnect.",
      { status: 403 },
    );
  }
  if (!res.ok) {
    throw new CopilotError(`Copilot token exchange failed (${res.status}).`, {
      status: res.status,
    });
  }

  const json = await res.json();
  if (!json.token) throw new CopilotError("Copilot did not return a token.");

  tokenCache.set(githubToken, {
    token: json.token,
    // expires_at is epoch seconds; fall back to a conservative 20 minutes.
    expiresAt: json.expires_at ? json.expires_at * 1000 : Date.now() + 20 * 60_000,
  });
  return json.token;
}

/**
 * Stream a chat completion as Server-Sent Events.
 *
 * Returns the upstream Response so the route can pipe it straight through
 * without buffering — the whole point of streaming is that the first token
 * reaches the browser immediately.
 */
export async function streamChat(githubToken, { model, messages, signal }) {
  const token = await copilotToken(githubToken);

  const res = await fetch(`${COPILOT_API}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...EDITOR_HEADERS,
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new CopilotError(
      `Copilot rejected the request (${res.status}). ${detail.slice(0, 200)}`,
      { status: res.status },
    );
  }
  return res;
}

/** Models offered in settings. Copilot exposes several; these are the stable ones. */
export const COPILOT_MODELS = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "o3-mini", label: "o3-mini" },
  { id: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
];

export const DEFAULT_COPILOT_MODEL = "gpt-4o";
