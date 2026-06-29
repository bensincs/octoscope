import { withUser } from "@/lib/apiHelpers";
import { isSuperAdmin } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// GET /api/admin/status — whether the signed-in user is a super admin.
// Drives the conditional "Super admins" entry in the user menu.
export async function GET() {
  return withUser(async (userId) => ({
    superAdmin: await isSuperAdmin(userId),
  }));
}
