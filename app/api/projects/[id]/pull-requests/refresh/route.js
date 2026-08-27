import { withUser } from "@/lib/apiHelpers";
import { refreshPullRequests } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/pull-requests/refresh — re-fetch from GitHub.
//
// A separate endpoint from the GET so that reading the tab can never trigger
// network calls by accident. Viewer access: refreshing is a read against
// GitHub, not a change to the project.
export async function POST(_req, { params }) {
  const { id } = await params;
  return withUser((userId) => refreshPullRequests(userId, id));
}
