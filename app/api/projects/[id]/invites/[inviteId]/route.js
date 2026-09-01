import { withUser } from "@/lib/apiHelpers";
import { revokeInvite } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// DELETE /api/projects/:id/invites/:inviteId — revoke an unused invite.
export async function DELETE(_req, { params }) {
  const { id, inviteId } = await params;
  return withUser((userId) => revokeInvite(userId, id, inviteId));
}
