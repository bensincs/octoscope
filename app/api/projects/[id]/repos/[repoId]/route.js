import { withUser } from "@/lib/apiHelpers";
import { deleteRepo, updateRepoPat } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// PATCH /api/projects/:id/repos/:repoId — replace the repo's stored PAT.
export async function PATCH(req, { params }) {
  const { id, repoId } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser((userId) => updateRepoPat(userId, id, repoId, body.pat));
}

// DELETE /api/projects/:id/repos/:repoId — remove a repo from the project.
export async function DELETE(_req, { params }) {
  const { id, repoId } = await params;
  return withUser((userId) => deleteRepo(userId, id, repoId));
}
