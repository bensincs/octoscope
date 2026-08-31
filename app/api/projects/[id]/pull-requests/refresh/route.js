import { withUser } from "@/lib/apiHelpers";
import { getToken } from "@/lib/session";
import { refreshPullRequests } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/pull-requests/refresh — re-fetch from GitHub.
//
// A separate endpoint from the GET so that reading the tab can never trigger
// network calls by accident. Viewer access: refreshing is a read against
// GitHub, not a change to the project.
export async function POST(_req, { params }) {
  const { id } = await params;
  // Supplied by the route, not read inside the data layer, so persistence
  // logic stays free of session concerns. Only used when the project is set to
  // use each member's GitHub sign-in.
  const viewerToken = await getToken();
  return withUser((userId) => refreshPullRequests(userId, id, { viewerToken }));
}
