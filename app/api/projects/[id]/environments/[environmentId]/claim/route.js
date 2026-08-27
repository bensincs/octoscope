import { withUser } from "@/lib/apiHelpers";
import { claimEnvironment, releaseEnvironment } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/environments/:environmentId/claim — take an environment.
//
// Separate from PATCH on the environment itself because the two have different
// access bars: editing an environment is `editor`, claiming one is `viewer`.
export async function POST(req, { params }) {
  const { id, environmentId } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser((userId) =>
    claimEnvironment(userId, id, environmentId, { note: body.note })
  );
}

// DELETE /api/projects/:id/environments/:environmentId/claim — release it.
export async function DELETE(_req, { params }) {
  const { id, environmentId } = await params;
  return withUser((userId) => releaseEnvironment(userId, id, environmentId));
}
