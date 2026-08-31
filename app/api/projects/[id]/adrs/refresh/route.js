import { withUser } from "@/lib/apiHelpers";
import { getToken } from "@/lib/session";
import { refreshAdrs } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/adrs/refresh — re-read the folder from GitHub.
// Viewer access, matching issues and pull requests: refreshing reads from
// GitHub, it doesn't change the project.
export async function POST(_req, { params }) {
  const { id } = await params;
  // Supplied by the route, not read inside the data layer, so persistence
  // logic stays free of session concerns. Only used when the project is set to
  // use each member's GitHub sign-in.
  const viewerToken = await getToken();
  return withUser((userId) => refreshAdrs(userId, id, { viewerToken }));
}
