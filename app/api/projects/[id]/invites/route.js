import { withUser } from "@/lib/apiHelpers";
import { listInvites, createInvite } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/invites — invites for a project (admin access).
// Never returns a token: only a hash is stored, so there is none to return.
export async function GET(_req, { params }) {
  const { id } = await params;
  return withUser(async (userId) => ({
    invites: await listInvites(userId, id),
  }));
}

// POST /api/projects/:id/invites — create a single-use, time-limited link.
// The plaintext token is in THIS response and nowhere else, ever.
export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser(
    (userId) =>
      createInvite(userId, id, {
        role: body.role,
        expiresInHours: body.expiresInHours,
      }),
    { status: 201 }
  );
}
