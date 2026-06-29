import { resolveToken, unauthorized } from "@/lib/session";
import { getOwners } from "@/lib/github";

export async function GET(req) {
  const token = await resolveToken(req);
  if (!token) return unauthorized();
  try {
    return Response.json(await getOwners(token));
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
