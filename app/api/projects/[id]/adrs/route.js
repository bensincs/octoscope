import { withUser } from "@/lib/apiHelpers";
import { listAdrs } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/adrs — cached ADRs (viewer access).
// Reads the cache only; never calls GitHub. Use POST .../refresh for that.
export async function GET(_req, { params }) {
  const { id } = await params;
  return withUser((userId) => listAdrs(userId, id));
}
