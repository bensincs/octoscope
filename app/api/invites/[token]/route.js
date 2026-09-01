import { previewInvite } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// GET /api/invites/:token — what this invite grants, without consuming it.
//
// Deliberately NOT behind withUser: someone following a link needs to see what
// they are being invited to before signing in. It reveals only the project name
// and role, to a caller who already holds the token.
export async function GET(_req, { params }) {
  const { token } = await params;
  const result = await previewInvite(token);
  return Response.json(result, {
    status: result.valid ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}
