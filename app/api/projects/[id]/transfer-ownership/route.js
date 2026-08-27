import { withUser } from "@/lib/apiHelpers";
import { transferOwnership } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/transfer-ownership — hand the project to another
// member and demote yourself to admin. Owner only, and not available to super
// admins acting on a project they don't own.
export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser((userId) =>
    transferOwnership(userId, id, body.collaboratorId)
  );
}
