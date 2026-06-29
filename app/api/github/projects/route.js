import { resolveToken, unauthorized } from "@/lib/session";
import { getProjects } from "@/lib/github";

export async function GET(req) {
  const token = await resolveToken(req);
  if (!token) return unauthorized();
  const login = req.nextUrl.searchParams.get("login");
  if (!login) return Response.json({ error: "Missing login." }, { status: 400 });
  try {
    return Response.json(await getProjects(token, login));
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
