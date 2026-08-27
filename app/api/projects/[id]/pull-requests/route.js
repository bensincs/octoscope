import { withUser } from "@/lib/apiHelpers";
import { listPullRequests } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/pull-requests — cached open PRs (viewer access).
// Reads the cache only; never calls GitHub. Use POST .../refresh for that.
export async function GET(_req, { params }) {
  const { id } = await params;
  return withUser((userId) => listPullRequests(userId, id));
}
