import { resolveToken, unauthorized } from "@/lib/session";
import { searchUsers } from "@/lib/github";

export const dynamic = "force-dynamic";

// GET /api/github/users?q=octocat — type-ahead GitHub user search for the
// collaborator picker. Read-only; uses the OAuth session token (or a PAT header).
export async function GET(req) {
  const token = await resolveToken(req);
  if (!token) return unauthorized();
  const q = new URL(req.url).searchParams.get("q") || "";
  try {
    return Response.json(await searchUsers(token, q));
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
