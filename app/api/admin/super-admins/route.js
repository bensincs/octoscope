import { withUser } from "@/lib/apiHelpers";
import { listSuperAdmins, addSuperAdmin } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// GET /api/admin/super-admins — list super admins (super-admin access).
export async function GET() {
  return withUser(async (userId) => ({
    superAdmins: await listSuperAdmins(userId),
  }));
}

// POST /api/admin/super-admins — grant super-admin to a GitHub login.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return withUser((userId) => addSuperAdmin(userId, { login: body.login }), {
    status: 201,
  });
}
