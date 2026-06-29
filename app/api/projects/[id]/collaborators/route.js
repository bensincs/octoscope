import { withUser } from "@/lib/apiHelpers";
import { listCollaborators, addCollaborator } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/collaborators — owner + collaborators (viewer access).
export async function GET(_req, { params }) {
  const { id } = await params;
  return withUser(async (userId) => ({
    collaborators: await listCollaborators(userId, id),
  }));
}

// POST /api/projects/:id/collaborators — invite a collaborator by login + role.
export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser(
    (userId) => addCollaborator(userId, id, { login: body.login, role: body.role }),
    { status: 201 }
  );
}
