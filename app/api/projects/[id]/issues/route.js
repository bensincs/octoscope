import { withUser } from "@/lib/apiHelpers";
import { getIssueSnapshot } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/issues — cached issue snapshot (viewer access).
// Reads the cache only; never calls GitHub. Use POST .../refresh for that.
export async function GET(_req, { params }) {
  const { id } = await params;
  return withUser((userId) => getIssueSnapshot(userId, id));
}
