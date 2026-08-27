import { getUserId } from "@/lib/session";
import { errorResponse } from "@/lib/apiHelpers";
import { getAgentConnection } from "@/lib/db/projects";
import { streamChat, DEFAULT_MODEL, AgentError } from "@/lib/agent";

export const dynamic = "force-dynamic";

const MAX_MESSAGES = 40;
const MAX_CHARS = 24_000;

// POST /api/projects/:id/agent/chat — stream a reply from the project's model.
//
// Not wrapped in withUser because the success path is a STREAM, not JSON.
//
// Viewer access: using the agent is not a configuration change. The API key
// belongs to the project and is decrypted server-side only — it is never sent
// to the browser, so a member can use the agent without ever holding the key.
export async function POST(req, { params }) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const conn = await getAgentConnection(userId, id);
    if (!conn.enabled) {
      return Response.json(
        { error: "The agent is not enabled for this project." },
        { status: 400 }
      );
    }
    if (!conn.baseUrl || !conn.apiKey) {
      return Response.json(
        { error: "The agent has no endpoint or API key configured." },
        { status: 428 }
      );
    }

    // Bound the transcript. The client is ephemeral and replays history each
    // turn, so without a cap a long conversation grows unboundedly and fails
    // upstream with a far less obvious error.
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => m && typeof m.content === "string" && m.role)
      .slice(-MAX_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

    if (messages.length === 0) {
      return Response.json({ error: "Nothing to send." }, { status: 400 });
    }

    const upstream = await streamChat({
      baseUrl: conn.baseUrl,
      apiKey: conn.apiKey,
      model: conn.model || DEFAULT_MODEL,
      messages,
      signal: req.signal,
    });

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    if (e instanceof AgentError) {
      return Response.json({ error: e.message }, { status: e.status || 502 });
    }
    return errorResponse(e);
  }
}
