import { getUserId } from "@/lib/session";
import { errorResponse } from "@/lib/apiHelpers";
import { getProjectForAudit } from "@/lib/db/projects";
import { runSavedAudit } from "@/lib/github";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/audit — run a read-only audit across all of the
// project's repos + boards (each using its own stored PAT) and return the
// aggregated issue set plus the rulebook config. The client builds the tree.
export async function POST(req, { params }) {
  const userId = await getUserId();
  if (!userId) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const includeClosed = !!body.includeClosed;

  try {
    const project = await getProjectForAudit(userId, id);
    if (project.repos.length === 0) {
      return Response.json(
        { error: "Add at least one repository before running an audit." },
        { status: 400 }
      );
    }

    const result = await runSavedAudit({
      repos: project.repos,
      boards: project.boards,
      includeClosed,
    });

    return Response.json({
      project: { id: project.id, name: project.name },
      config: project.config,
      issues: result.issues,
      repos: result.repos,
      boards: result.boards,
      projectActive: result.projectActive,
      warnings: result.warnings,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
