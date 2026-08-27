import { withUser } from "@/lib/apiHelpers";
import { getProject, updateProject, deleteProject } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// GET /api/projects/:id — one project with masked repos + boards.
export async function GET(_req, { params }) {
  const { id } = await params;
  return withUser((userId) => getProject(userId, id));
}

// PATCH /api/projects/:id — update name, config and/or the welcome page.
//
// Every field the client may set has to be forwarded explicitly. An omitted key
// is indistinguishable from "not supplied" downstream, so a missing one here
// makes updateProject a silent no-op that still returns 200.
export async function PATCH(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser((userId) =>
    updateProject(userId, id, {
      name: body.name,
      config: body.config,
      welcomeMarkdown: body.welcomeMarkdown,
      includeClosedIssues: body.includeClosedIssues,
      adrRepoId: body.adrRepoId,
      adrPath: body.adrPath,
      agentEnabled: body.agentEnabled,
      agentModel: body.agentModel,
    })
  );
}

// DELETE /api/projects/:id — remove the project (cascades to repos + boards).
export async function DELETE(_req, { params }) {
  const { id } = await params;
  return withUser((userId) => deleteProject(userId, id));
}
