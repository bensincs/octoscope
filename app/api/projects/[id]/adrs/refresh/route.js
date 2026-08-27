import { withUser } from "@/lib/apiHelpers";
import { refreshAdrs } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/adrs/refresh — re-read the folder from GitHub.
// Viewer access, matching issues and pull requests: refreshing reads from
// GitHub, it doesn't change the project.
export async function POST(_req, { params }) {
  const { id } = await params;
  return withUser((userId) => refreshAdrs(userId, id));
}
