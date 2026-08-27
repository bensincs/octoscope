import { withUser } from "@/lib/apiHelpers";
import { updateEnvironment, deleteEnvironment } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// PATCH /api/projects/:id/environments/:environmentId — rename/re-describe.
export async function PATCH(req, { params }) {
  const { id, environmentId } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser((userId) =>
    updateEnvironment(userId, id, environmentId, {
      name: body.name,
      description: body.description,
    })
  );
}

// DELETE /api/projects/:id/environments/:environmentId — remove an environment.
export async function DELETE(_req, { params }) {
  const { id, environmentId } = await params;
  return withUser((userId) => deleteEnvironment(userId, id, environmentId));
}
