import { withUser } from "@/lib/apiHelpers";
import { acceptInvite } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// POST /api/invites/:token/accept — redeem an invite.
//
// Any signed-in user: the token IS the authorisation. withUser supplies the
// identity to attach the membership to, and rejects anonymous callers.
export async function POST(_req, { params }) {
  const { token } = await params;
  return withUser((userId) => acceptInvite(userId, token));
}
