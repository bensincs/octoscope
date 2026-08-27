import { withUser } from "@/lib/apiHelpers";
import { refreshIssues } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/issues/refresh — re-run the audit against GitHub and
// replace the shared snapshot.
//
// Viewer access: refreshing reads from GitHub, it doesn't change the project.
// Separate from the GET so opening the tab can never trigger network calls.
export async function POST(_req, { params }) {
  const { id } = await params;
  return withUser((userId) => refreshIssues(userId, id));
}
