import { auth } from "@/lib/auth";

/** Header carrying a user-supplied Personal Access Token. */
export const PAT_HEADER = "x-github-pat";

/** Returns the GitHub access token for the signed-in user, or null. */
export async function getToken() {
  const session = await auth();
  return session?.accessToken || null;
}

/** Returns the app user id (users.id) for the signed-in user, or null. */
export async function getUserId() {
  const session = await auth();
  return session?.user?.id || null;
}

/**
 * Resolve the GitHub token to use for a request.
 *
 * A user-supplied Personal Access Token (sent in the `x-github-pat` header)
 * takes precedence over the OAuth session token. This lets the user reach
 * repos/orgs/projects their OAuth grant can't see by pasting a PAT in the UI.
 * The PAT is only ever read from the request header — never persisted or logged.
 *
 * Returns the token string, or null if neither a PAT nor a session is present.
 */
export async function resolveToken(req) {
  const pat = req?.headers?.get(PAT_HEADER)?.trim();
  if (pat) return pat;
  return getToken();
}

export function unauthorized() {
  return Response.json({ error: "Not signed in." }, { status: 401 });
}
