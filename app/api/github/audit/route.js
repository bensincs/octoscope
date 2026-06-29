import { resolveToken, unauthorized } from "@/lib/session";
import { streamAudit } from "@/lib/github";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const token = await resolveToken(req);
  if (!token) return unauthorized();

  const body = await req.json();
  const { repoOwner, repoName, includeClosed, project } = body;
  if (!repoOwner || !repoName) {
    return Response.json({ error: "Missing repository." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        for await (const ev of streamAudit(token, {
          repoOwner,
          repoName,
          includeClosed: !!includeClosed,
          project: project || null,
        })) {
          send(ev);
        }
      } catch (e) {
        send({ type: "error", error: e.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
