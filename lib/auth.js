import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { db } from "./db/index.js";
import { users, superAdmins, projectCollaborators } from "./db/schema.js";
import { eq, and, isNull } from "drizzle-orm";

/**
 * Link any rows that were created by GitHub login before this account existed.
 * Best-effort: a failure here must never block sign-in.
 */
async function linkPendingRows(userId, login) {
  if (!userId || !login) return;
  const lower = String(login).toLowerCase();
  try {
    await db
      .update(superAdmins)
      .set({ userId })
      .where(and(eq(superAdmins.login, lower), isNull(superAdmins.userId)));
    await db
      .update(projectCollaborators)
      .set({ userId })
      .where(
        and(
          eq(projectCollaborators.login, lower),
          isNull(projectCollaborators.userId)
        )
      );
  } catch (err) {
    console.error("[auth] linking pending rows failed:", err);
  }
}

/**
 * Upsert the signing-in GitHub user into our users table and return its row id.
 * Keyed on the GitHub numeric id (stable across login renames).
 */
async function upsertUser(profile) {
  const githubId = String(profile.id);
  const values = {
    githubId,
    login: profile.login,
    name: profile.name ?? null,
    email: profile.email ?? null,
    avatarUrl: profile.avatar_url ?? null,
  };
  const [row] = await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.githubId,
      set: {
        login: values.login,
        name: values.name,
        email: values.email,
        avatarUrl: values.avatarUrl,
      },
    })
    .returning({ id: users.id });
  if (row?.id) return row.id;
  // Fallback (shouldn't happen): look it up.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubId, githubId))
    .limit(1);
  return existing?.id ?? null;
}

// Scopes:
//   read:user    – profile
//   read:org     – list the orgs you belong to
//   repo         – read issues in public AND private repos (read-only usage)
//   read:project – read Projects v2 (status + sprint fields)
const SCOPES = "read:user read:org repo read:project";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Trust the deployment host (required for self-hosted / localhost in v5).
  trustHost: true,
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorization: { params: { scope: SCOPES } },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile }) {
      // Persist the GitHub access token + login on first sign-in.
      if (account) token.accessToken = account.access_token;
      if (profile) {
        token.login = profile.login;
        token.avatarUrl = profile.avatar_url;
        // Upsert into our DB and remember the app user id.
        try {
          token.userId = await upsertUser(profile);
          // Rows can be created for a GitHub login before that person has ever
          // signed in (seeded super admins, invited collaborators). Link them
          // now that an account exists, so they stop reading as "pending".
          await linkPendingRows(token.userId, profile.login);
        } catch (err) {
          console.error("[auth] user upsert failed:", err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      if (session.user) {
        session.user.id = token.userId;
        session.user.login = token.login;
        session.user.image = session.user.image || token.avatarUrl;
      }
      return session;
    },
  },
});
