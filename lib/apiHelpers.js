import { getUserId } from "@/lib/session";
import { ValidationError, NotFoundError, ForbiddenError } from "@/lib/db/projects";

/**
 * Guard a route handler: resolve the signed-in app user id (401 if absent) and
 * map data-layer errors to clean HTTP responses.
 *
 *   ValidationError → 400 { error, fields: [...] }
 *   ForbiddenError  → 403 { error }
 *   NotFoundError   → 404 { error }
 *   anything else   → 500 { error }
 *
 * `fn` receives the resolved `userId` and returns data to be JSON-serialized
 * (or a Response to short-circuit). Pass `{ status }` to override the success code.
 */
export async function withUser(fn, { status = 200 } = {}) {
  const userId = await getUserId();
  if (!userId) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  try {
    const result = await fn(userId);
    if (result instanceof Response) return result;
    return Response.json(result, { status });
  } catch (e) {
    return errorResponse(e);
  }
}

export function errorResponse(e) {
  if (e instanceof ValidationError) {
    return Response.json({ error: e.message, fields: e.errors }, { status: 400 });
  }
  if (e instanceof ForbiddenError) {
    return Response.json({ error: e.message }, { status: 403 });
  }
  if (e instanceof NotFoundError) {
    return Response.json({ error: e.message }, { status: 404 });
  }
  console.error("[api] unhandled error:", e);
  return Response.json({ error: e.message || "Server error." }, { status: 500 });
}
