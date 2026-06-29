import { withUser } from "@/lib/apiHelpers";
import { deleteBoard, updateBoardPat } from "@/lib/db/projects";

export const dynamic = "force-dynamic";

// PATCH /api/projects/:id/boards/:boardId — replace the board's stored PAT.
export async function PATCH(req, { params }) {
  const { id, boardId } = await params;
  const body = await req.json().catch(() => ({}));
  return withUser((userId) => updateBoardPat(userId, id, boardId, body.pat));
}

// DELETE /api/projects/:id/boards/:boardId — remove a board from the project.
export async function DELETE(_req, { params }) {
  const { id, boardId } = await params;
  return withUser((userId) => deleteBoard(userId, id, boardId));
}
