import { withUser } from "@/lib/apiHelpers";
import { removeSuperAdmin } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// DELETE /api/admin/super-admins/:adminId — revoke super-admin access.
export async function DELETE(_req, { params }) {
  const { adminId } = await params;
  return withUser((userId) => removeSuperAdmin(userId, adminId));
}
