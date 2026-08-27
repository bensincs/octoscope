import { getUserId } from "@/lib/session";
import { errorResponse } from "@/lib/apiHelpers";
import { getAgentSettings, getLlmToken } from "@/lib/db/projects";
import { streamChat, DEFAULT_COPILOT_MODEL, CopilotError } from "@/lib/copilot";

export const dynamic = "force-dynamic";

const MAX_MESSAGES = 40;
const MAX_CHARS = 24_000;

// POST /api/projects/:id/agent/chat — stream a reply from the user's own LLM.
//
// Not wrapped in withUser because the success path is a STREAM, not JSON: the
// point is that the first token reaches the browser immediately rather than
// after the whole reply is buffered.
//
// The credential is the caller's own (a Copilot seat is per person), so nothing
// here consults the project owner's credentials.
export async function POST(req, { params }) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  try {
    const settings = await getAgentSettings(userId, id);
    if (!settings.enabled) {
      return Response.json(
        { error: "The agent is not enabled for this project." },
        { status: 400 }
      );
    }

    const token = await getLlmToken(userId);
    if (!token) {
      return Response.json(
        { error: "Connect your GitHub Copilot account first." },
        { status: 428 }
      );
    }

    // Bound the transcript. The client is ephemeral and replays history on
    // every turn, so without a cap a long conversation grows unboundedly and
    // eventually fails upstream with a far less obvious error.
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => m && typeof m.content === "string" && m.role)
      .slice(-MAX_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

    if (messages.length === 0) {
      return Response.json({ error: "Nothing to send." }, { status: 400 });
    }

    const upstream = await streamChat(token, {
      model: settings.model || DEFAULT_COPILOT_MODEL,
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
    if (e instanceof CopilotError) {
      return Response.json({ error: e.message }, { status: e.status || 502 });
    }
    return errorResponse(e);
  }
}
