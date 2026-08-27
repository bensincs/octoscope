import { withUser } from "@/lib/apiHelpers";
import { listEnvironments, addEnvironment } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/environments — environments + claim state (viewer access).
export async function GET(_req, { params }) {
  const { id } = await params;
  return withUser(async (userId) => ({
    environments: await listEnvironments(userId, id),
  }));
}

// POST /api/projects/:id/environments — define a new environment (editor access).
export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser(
    (userId) =>
      addEnvironment(userId, id, {
        name: body.name,
        description: body.description,
      }),
    { status: 201 }
  );
}
