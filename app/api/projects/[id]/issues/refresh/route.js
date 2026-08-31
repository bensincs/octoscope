import { withUser } from "@/lib/apiHelpers";
import { getToken } from "@/lib/session";
import { refreshIssues } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/issues/refresh — re-run the audit against GitHub and
// replace the shared snapshot.
//
// Viewer access: refreshing reads from GitHub, it doesn't change the project.
// Separate from the GET so opening the tab can never trigger network calls.
export async function POST(_req, { params }) {
  const { id } = await params;
  // Supplied by the route, not read inside the data layer, so persistence
  // logic stays free of session concerns. Only used when the project is set to
  // use each member's GitHub sign-in.
  const viewerToken = await getToken();
  return withUser((userId) => refreshIssues(userId, id, { viewerToken }));
}
