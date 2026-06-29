import { withUser } from "@/lib/apiHelpers";
import { addBoard } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// POST /api/projects/:id/boards — add a Projects v2 board (with its own PAT).
export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser(
    (userId) =>
      addBoard(userId, id, {
        ownerLogin: body.ownerLogin,
        projectNumber: body.projectNumber,
        title: body.title,
        pat: body.pat,
      }),
    { status: 201 }
  );
}
