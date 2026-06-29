import { withUser } from "@/lib/apiHelpers";
import { listProjects, createProject } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// GET /api/projects — list the signed-in user's audit projects.
export async function GET() {
  return withUser(async (userId) => ({ projects: await listProjects(userId) }));
}

// POST /api/projects — create a new audit project.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return withUser(
    (userId) => createProject(userId, { name: body.name, config: body.config }),
    { status: 201 }
  );
}
