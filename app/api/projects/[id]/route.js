import { withUser } from "@/lib/apiHelpers";
import { getProject, updateProject, deleteProject } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// GET /api/projects/:id — one project with masked repos + boards.
export async function GET(_req, { params }) {
  const { id } = await params;
  return withUser((userId) => getProject(userId, id));
}

// PATCH /api/projects/:id — update name and/or config.
export async function PATCH(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser((userId) =>
    updateProject(userId, id, { name: body.name, config: body.config })
  );
}

// DELETE /api/projects/:id — remove the project (cascades to repos + boards).
export async function DELETE(_req, { params }) {
  const { id } = await params;
  return withUser((userId) => deleteProject(userId, id));
}
