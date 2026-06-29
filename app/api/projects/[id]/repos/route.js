import { withUser } from "@/lib/apiHelpers";
import { addRepo } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/repos — add a repo (with its own PAT) to the project.
export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser(
    (userId) =>
      addRepo(userId, id, { owner: body.owner, name: body.name, pat: body.pat }),
    { status: 201 }
  );
}
