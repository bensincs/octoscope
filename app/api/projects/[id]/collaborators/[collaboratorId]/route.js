import { withUser } from "@/lib/apiHelpers";
import { updateCollaboratorRole, removeCollaborator } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// PATCH /api/projects/:id/collaborators/:collaboratorId — change a role.
export async function PATCH(req, { params }) {
  const { id, collaboratorId } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser((userId) =>
    updateCollaboratorRole(userId, id, collaboratorId, body.role)
  );
}

// DELETE /api/projects/:id/collaborators/:collaboratorId — remove a collaborator.
export async function DELETE(_req, { params }) {
  const { id, collaboratorId } = await params;
  return withUser((userId) => removeCollaborator(userId, id, collaboratorId));
}
