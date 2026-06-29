// Data-access layer for saved audit projects.
//
// Access is ROLE-CHECKED. Every project has an OWNER (auditProjects.userId) plus
// optional collaborators (project_collaborators) with a role:
//
//   viewer  — open the project and run audits
//   editor  — viewer + edit name/rulebook and manage repos/boards
//   admin   — editor + manage collaborators
//   owner   — admin + delete the project (implicit, never a collaborator row)
//
// requireAccess(userId, projectId, minRole) resolves the caller's effective role
// and throws NotFoundError (to hide existence) when they have none, or
// ForbiddenError when their role is below what the operation needs.
//
// PATs are encrypted at rest (lib/crypto.js). They are decrypted ONLY by
// getProjectForAudit(), which runs server-side to talk to GitHub. Every other
// read masks them out: the client receives `hasPat: true` and never any
// plaintext or ciphertext.
//
// `config` is validated through lib/config.js before it is ever persisted.

import { and, eq, or, inArray, sql } from "drizzle-orm";
import { db } from "./index.js";
import {
  users,
  auditProjects,
  auditRepos,
  auditBoards,
  projectCollaborators,
  superAdmins,
} from "./schema.js";
import { encrypt, decrypt } from "../crypto.js";
import { validateConfig } from "../config.js";
import { DEFAULT_CONFIG } from "../hierarchy.js";
import { isAssignableRole, meetsRole, effectiveRole, isSelfAdminRow } from "../access.js";

class ValidationError extends Error {
  constructor(errors) {
    super("Invalid configuration");
    this.name = "ValidationError";
    this.errors = errors;
  }
}
class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}
class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}
export { ValidationError, NotFoundError, ForbiddenError };

const lower = (s) => String(s ?? "").trim().toLowerCase();

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/** List the user's audit projects (owned + shared) with counts (newest first). */
export async function listProjects(userId) {
  const me = await getUserCtx(userId);
  // Super admins see EVERY project with owner-equivalent access.
  const superAdmin = await isSuperAdminCtx(me);

  // Projects shared with me as a collaborator (by linked userId or by login).
  const collabRows = await db
    .select({
      projectId: projectCollaborators.projectId,
      role: projectCollaborators.role,
    })
    .from(projectCollaborators)
    .where(collaboratorMatch(me));
  const roleByPid = new Map(collabRows.map((r) => [r.projectId, r.role]));
  const sharedIds = [...roleByPid.keys()];

  // Super admins get an unscoped list; everyone else sees owned + shared only.
  const scope = superAdmin
    ? undefined
    : sharedIds.length
    ? or(eq(auditProjects.userId, userId), inArray(auditProjects.id, sharedIds))
    : eq(auditProjects.userId, userId);

  const base = db
    .select({
      id: auditProjects.id,
      userId: auditProjects.userId,
      name: auditProjects.name,
      config: auditProjects.config,
      createdAt: auditProjects.createdAt,
      updatedAt: auditProjects.updatedAt,
      repoCount: sql`(
        select count(*) from ${auditRepos}
        where ${auditRepos.projectId} = ${auditProjects.id}
      )`.mapWith(Number),
      boardCount: sql`(
        select count(*) from ${auditBoards}
        where ${auditBoards.projectId} = ${auditProjects.id}
      )`.mapWith(Number),
    })
    .from(auditProjects);

  const rows = await (scope ? base.where(scope) : base).orderBy(
    sql`${auditProjects.updatedAt} desc`
  );

  return rows.map(({ userId: ownerId, ...r }) => ({
    ...r,
    role:
      effectiveRole({
        isOwner: ownerId === userId,
        collabRole: roleByPid.get(r.id) ?? null,
        isSuperAdmin: superAdmin,
      }) || "viewer",
  }));
}

/**
 * Create a new audit project. Config defaults to DEFAULT_CONFIG and is always
 * validated/cleaned before persistence.
 */
export async function createProject(userId, { name, config } = {}) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) throw new ValidationError([{ field: "name", message: "Name is required." }]);

  const result = validateConfig(config ?? DEFAULT_CONFIG);
  if (!result.ok) throw new ValidationError(result.errors);

  const [row] = await db
    .insert(auditProjects)
    .values({ userId, name: cleanName, config: result.value })
    .returning();
  return toProjectSummary(row);
}

/** Fetch one project (viewer access) with masked repos + boards. */
export async function getProject(userId, projectId) {
  const { project, role } = await requireAccess(userId, projectId, "viewer");
  const [repos, boards] = await Promise.all([
    db.select().from(auditRepos).where(eq(auditRepos.projectId, projectId)),
    db.select().from(auditBoards).where(eq(auditBoards.projectId, projectId)),
  ]);
  return {
    ...toProjectSummary(project),
    viewerRole: role,
    repos: repos.map(toRepoView),
    boards: boards.map(toBoardView),
  };
}

/**
 * Fetch a project with DECRYPTED PATs, shaped for runSavedAudit().
 * Server-only — never serialize this to the client.
 */
export async function getProjectForAudit(userId, projectId) {
  const { project } = await requireAccess(userId, projectId, "viewer");
  const [repos, boards] = await Promise.all([
    db.select().from(auditRepos).where(eq(auditRepos.projectId, projectId)),
    db.select().from(auditBoards).where(eq(auditBoards.projectId, projectId)),
  ]);
  return {
    id: project.id,
    name: project.name,
    config: project.config,
    repos: repos.map((r) => ({
      id: r.id,
      owner: r.owner,
      name: r.name,
      token: decrypt(r.encryptedPat),
    })),
    boards: boards.map((b) => ({
      id: b.id,
      login: b.ownerLogin,
      number: b.projectNumber,
      title: b.title,
      token: decrypt(b.encryptedPat),
    })),
  };
}

/** Update a project's name and/or config (editor access). */
export async function updateProject(userId, projectId, { name, config } = {}) {
  await requireAccess(userId, projectId, "editor");

  const set = {};
  if (name !== undefined) {
    const cleanName = String(name ?? "").trim();
    if (!cleanName) throw new ValidationError([{ field: "name", message: "Name is required." }]);
    set.name = cleanName;
  }
  if (config !== undefined) {
    const result = validateConfig(config);
    if (!result.ok) throw new ValidationError(result.errors);
    set.config = result.value;
  }
  if (Object.keys(set).length === 0) {
    return getProject(userId, projectId);
  }

  await db
    .update(auditProjects)
    .set(set)
    .where(eq(auditProjects.id, projectId));
  return getProject(userId, projectId);
}

/** Delete a project (owner only; cascades to repos, boards + collaborators). */
export async function deleteProject(userId, projectId) {
  await requireAccess(userId, projectId, "owner");
  const [row] = await db
    .delete(auditProjects)
    .where(eq(auditProjects.id, projectId))
    .returning({ id: auditProjects.id });
  if (!row) throw new NotFoundError("Project not found.");
  return { id: row.id };
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

/** Add a repo (with its own PAT) to a project. owner/name stored lowercased. */
export async function addRepo(userId, projectId, { owner, name, pat } = {}) {
  await requireAccess(userId, projectId, "editor");

  const o = lower(owner);
  const n = lower(name);
  const errors = [];
  if (!o) errors.push({ field: "owner", message: "Owner is required." });
  if (!n) errors.push({ field: "name", message: "Repository name is required." });
  if (!pat || typeof pat !== "string" || !pat.trim())
    errors.push({ field: "pat", message: "A Personal Access Token is required." });
  if (errors.length) throw new ValidationError(errors);

  try {
    const [row] = await db
      .insert(auditRepos)
      .values({ projectId, owner: o, name: n, encryptedPat: encrypt(pat.trim()) })
      .returning();
    await touchProject(projectId);
    return toRepoView(row);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ValidationError([
        { field: "name", message: `${o}/${n} is already in this project.` },
      ]);
    }
    throw e;
  }
}

/** Remove a repo from a project (ownership-checked via the parent project). */
export async function deleteRepo(userId, projectId, repoId) {
  await requireAccess(userId, projectId, "editor");
  const [row] = await db
    .delete(auditRepos)
    .where(and(eq(auditRepos.id, repoId), eq(auditRepos.projectId, projectId)))
    .returning({ id: auditRepos.id });
  if (!row) throw new NotFoundError("Repository not found.");
  await touchProject(projectId);
  return { id: row.id };
}

/** Replace a repo's stored PAT (ownership-checked). */
export async function updateRepoPat(userId, projectId, repoId, pat) {
  await requireAccess(userId, projectId, "editor");
  if (!pat || typeof pat !== "string" || !pat.trim())
    throw new ValidationError([
      { field: "pat", message: "A Personal Access Token is required." },
    ]);
  const [row] = await db
    .update(auditRepos)
    .set({ encryptedPat: encrypt(pat.trim()) })
    .where(and(eq(auditRepos.id, repoId), eq(auditRepos.projectId, projectId)))
    .returning();
  if (!row) throw new NotFoundError("Repository not found.");
  await touchProject(projectId);
  return toRepoView(row);
}

// ---------------------------------------------------------------------------
// Boards (Projects v2)
// ---------------------------------------------------------------------------

/** Add a Projects v2 board (with its own PAT) to a project. */
export async function addBoard(
  userId,
  projectId,
  { ownerLogin, projectNumber, title, pat } = {}
) {
  await requireAccess(userId, projectId, "editor");

  const login = lower(ownerLogin);
  const number = Number(projectNumber);
  const errors = [];
  if (!login) errors.push({ field: "ownerLogin", message: "Owner login is required." });
  if (!Number.isInteger(number) || number <= 0)
    errors.push({ field: "projectNumber", message: "Project number must be a positive integer." });
  if (!pat || typeof pat !== "string" || !pat.trim())
    errors.push({ field: "pat", message: "A Personal Access Token is required." });
  if (errors.length) throw new ValidationError(errors);

  try {
    const [row] = await db
      .insert(auditBoards)
      .values({
        projectId,
        ownerLogin: login,
        projectNumber: number,
        title: title ? String(title).trim() : null,
        encryptedPat: encrypt(pat.trim()),
      })
      .returning();
    await touchProject(projectId);
    return toBoardView(row);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ValidationError([
        {
          field: "projectNumber",
          message: `Project #${number} for ${login} is already in this project.`,
        },
      ]);
    }
    throw e;
  }
}

/** Remove a board from a project (ownership-checked via the parent project). */
export async function deleteBoard(userId, projectId, boardId) {
  await requireAccess(userId, projectId, "editor");
  const [row] = await db
    .delete(auditBoards)
    .where(and(eq(auditBoards.id, boardId), eq(auditBoards.projectId, projectId)))
    .returning({ id: auditBoards.id });
  if (!row) throw new NotFoundError("Board not found.");
  await touchProject(projectId);
  return { id: row.id };
}

/** Replace a board's stored PAT (ownership-checked). */
export async function updateBoardPat(userId, projectId, boardId, pat) {
  await requireAccess(userId, projectId, "editor");
  if (!pat || typeof pat !== "string" || !pat.trim())
    throw new ValidationError([
      { field: "pat", message: "A Personal Access Token is required." },
    ]);
  const [row] = await db
    .update(auditBoards)
    .set({ encryptedPat: encrypt(pat.trim()) })
    .where(and(eq(auditBoards.id, boardId), eq(auditBoards.projectId, projectId)))
    .returning();
  if (!row) throw new NotFoundError("Board not found.");
  await touchProject(projectId);
  return toBoardView(row);
}

// ---------------------------------------------------------------------------
// Collaborators
// ---------------------------------------------------------------------------

/** List a project's members: the owner first, then collaborators (viewer access). */
export async function listCollaborators(userId, projectId) {
  const { project } = await requireAccess(userId, projectId, "viewer");

  const [owner] = await db
    .select({ id: users.id, login: users.login, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, project.userId))
    .limit(1);

  const rows = await db
    .select({
      id: projectCollaborators.id,
      login: projectCollaborators.login,
      role: projectCollaborators.role,
      userId: projectCollaborators.userId,
      createdAt: projectCollaborators.createdAt,
      userLogin: users.login,
      userName: users.name,
      userAvatar: users.avatarUrl,
    })
    .from(projectCollaborators)
    .leftJoin(users, eq(users.id, projectCollaborators.userId))
    .where(eq(projectCollaborators.projectId, projectId))
    .orderBy(projectCollaborators.createdAt);

  return [
    {
      id: null,
      login: owner?.login ?? null,
      name: owner?.name ?? null,
      avatarUrl: owner?.avatarUrl ?? null,
      role: "owner",
      isOwner: true,
      pending: false,
      createdAt: null,
    },
    ...rows.map(toCollaboratorView),
  ];
}

/** Invite a collaborator by GitHub login with a role (admin access). */
export async function addCollaborator(userId, projectId, { login, role } = {}) {
  const { project } = await requireAccess(userId, projectId, "admin");

  const l = lower(login);
  const r = lower(role);
  const errors = [];
  if (!l) errors.push({ field: "login", message: "A GitHub username is required." });
  if (!isAssignableRole(r))
    errors.push({ field: "role", message: "Role must be viewer, editor or admin." });
  if (errors.length) throw new ValidationError(errors);

  // Can't add the owner as a collaborator.
  const [owner] = await db
    .select({ login: users.login })
    .from(users)
    .where(eq(users.id, project.userId))
    .limit(1);
  if (owner && lower(owner.login) === l)
    throw new ValidationError([{ field: "login", message: "That person already owns this project." }]);

  // Link to an existing app account if this login has signed in before.
  const [u] = await db
    .select({ id: users.id, login: users.login, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(sql`lower(${users.login}) = ${l}`)
    .limit(1);

  try {
    const [row] = await db
      .insert(projectCollaborators)
      .values({ projectId, userId: u?.id ?? null, login: l, role: r })
      .returning();
    await touchProject(projectId);
    return toCollaboratorView({
      ...row,
      userLogin: u?.login ?? null,
      userName: u?.name ?? null,
      userAvatar: u?.avatarUrl ?? null,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ValidationError([
        { field: "login", message: `${l} is already a collaborator.` },
      ]);
    }
    throw e;
  }
}

/** Change a collaborator's role (admin access). */
export async function updateCollaboratorRole(userId, projectId, collaboratorId, role) {
  await requireAccess(userId, projectId, "admin");
  const r = lower(role);
  if (!isAssignableRole(r))
    throw new ValidationError([{ field: "role", message: "Role must be viewer, editor or admin." }]);

  const [row] = await db
    .update(projectCollaborators)
    .set({ role: r })
    .where(
      and(
        eq(projectCollaborators.id, collaboratorId),
        eq(projectCollaborators.projectId, projectId)
      )
    )
    .returning();
  if (!row) throw new NotFoundError("Collaborator not found.");

  const [u] = row.userId
    ? await db
        .select({ login: users.login, name: users.name, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1)
    : [];
  await touchProject(projectId);
  return toCollaboratorView({
    ...row,
    userLogin: u?.login ?? null,
    userName: u?.name ?? null,
    userAvatar: u?.avatarUrl ?? null,
  });
}

/** Remove a collaborator from a project (admin access). */
export async function removeCollaborator(userId, projectId, collaboratorId) {
  await requireAccess(userId, projectId, "admin");
  const [row] = await db
    .delete(projectCollaborators)
    .where(
      and(
        eq(projectCollaborators.id, collaboratorId),
        eq(projectCollaborators.projectId, projectId)
      )
    )
    .returning({ id: projectCollaborators.id });
  if (!row) throw new NotFoundError("Collaborator not found.");
  await touchProject(projectId);
  return { id: row.id };
}

// ---------------------------------------------------------------------------
// Super admins (global, owner-equivalent on every project)
// ---------------------------------------------------------------------------

/** Is the signed-in user a super admin? Matched by linked userId OR login. */
export async function isSuperAdmin(userId) {
  if (!userId) return false;
  return isSuperAdminCtx(await getUserCtx(userId));
}

/** List all super admins, newest first (super-admin access required). */
export async function listSuperAdmins(userId) {
  await requireSuperAdmin(userId);
  const me = await getUserCtx(userId);

  const rows = await db
    .select({
      id: superAdmins.id,
      login: superAdmins.login,
      userId: superAdmins.userId,
      createdAt: superAdmins.createdAt,
      userLogin: users.login,
      userName: users.name,
      userAvatar: users.avatarUrl,
    })
    .from(superAdmins)
    .leftJoin(users, eq(users.id, superAdmins.userId))
    .orderBy(superAdmins.createdAt);

  return rows.map((r) => toSuperAdminView(r, me));
}

/** Grant super-admin to a GitHub login (super-admin access required). */
export async function addSuperAdmin(userId, { login } = {}) {
  await requireSuperAdmin(userId);

  const l = lower(login);
  if (!l)
    throw new ValidationError([
      { field: "login", message: "A GitHub username is required." },
    ]);

  // Link to an existing app account if this login has signed in before.
  const [u] = await db
    .select({ id: users.id, login: users.login, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(sql`lower(${users.login}) = ${l}`)
    .limit(1);

  try {
    const [row] = await db
      .insert(superAdmins)
      .values({ userId: u?.id ?? null, login: l })
      .returning();
    const me = await getUserCtx(userId);
    return toSuperAdminView(
      {
        ...row,
        userLogin: u?.login ?? null,
        userName: u?.name ?? null,
        userAvatar: u?.avatarUrl ?? null,
      },
      me
    );
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ValidationError([
        { field: "login", message: `${l} is already a super admin.` },
      ]);
    }
    throw e;
  }
}

/** Revoke super-admin (super-admin access required; can't remove yourself). */
export async function removeSuperAdmin(userId, superAdminId) {
  await requireSuperAdmin(userId);
  const me = await getUserCtx(userId);

  const [target] = await db
    .select()
    .from(superAdmins)
    .where(eq(superAdmins.id, superAdminId))
    .limit(1);
  if (!target) throw new NotFoundError("Super admin not found.");

  // Guard against locking yourself out.
  if (isSelfAdminRow(target, me))
    throw new ValidationError([
      { field: "login", message: "You can't remove your own super-admin access." },
    ]);

  await db.delete(superAdmins).where(eq(superAdmins.id, superAdminId));
  return { id: superAdminId };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Minimal identity for the signed-in user: { id, login } (or null). */
async function getUserCtx(userId) {
  const [row] = await db
    .select({ id: users.id, login: users.login })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row || null;
}

/** A collaborator-row predicate matching the given user by userId OR login. */
function collaboratorMatch(me) {
  const conds = [eq(projectCollaborators.userId, me?.id ?? null)];
  if (me?.login) conds.push(eq(projectCollaborators.login, lower(me.login)));
  return or(...conds);
}

/** A super-admin-row predicate matching the given user by userId OR login. */
function superAdminMatch(me) {
  const conds = [eq(superAdmins.userId, me?.id ?? null)];
  if (me?.login) conds.push(eq(superAdmins.login, lower(me.login)));
  return or(...conds);
}

/** Is this resolved user-ctx a super admin? (null-safe) */
async function isSuperAdminCtx(me) {
  if (!me) return false;
  const [row] = await db
    .select({ id: superAdmins.id })
    .from(superAdmins)
    .where(superAdminMatch(me))
    .limit(1);
  return !!row;
}

/** Assert the caller is a super admin, else ForbiddenError. */
async function requireSuperAdmin(userId) {
  if (!(await isSuperAdmin(userId)))
    throw new ForbiddenError("Super-admin access is required.");
}

/**
 * Resolve the caller's effective role on a project and assert it meets minRole.
 * Throws NotFoundError when the caller has no access at all (hides existence)
 * and ForbiddenError when they have access but an insufficient role.
 * Returns { project, role }.
 */
async function requireAccess(userId, projectId, minRole = "viewer") {
  const [project] = await db
    .select()
    .from(auditProjects)
    .where(eq(auditProjects.id, projectId))
    .limit(1);
  if (!project) throw new NotFoundError("Project not found.");

  let role = null;
  if (project.userId === userId) {
    role = "owner";
  } else {
    const me = await getUserCtx(userId);
    const [collab] = await db
      .select({ role: projectCollaborators.role })
      .from(projectCollaborators)
      .where(and(eq(projectCollaborators.projectId, projectId), collaboratorMatch(me)))
      .limit(1);
    // Super admins are owner-equivalent on every project, even ones they
    // neither own nor collaborate on.
    role = effectiveRole({
      isOwner: false,
      collabRole: collab?.role ?? null,
      isSuperAdmin: await isSuperAdminCtx(me),
    });
  }

  if (!role) throw new NotFoundError("Project not found.");
  if (!meetsRole(role, minRole))
    throw new ForbiddenError("You don't have permission to do that.");
  return { project, role };
}

/** Bump a project's updatedAt when a child repo/board changes. */
async function touchProject(projectId) {
  await db
    .update(auditProjects)
    .set({ updatedAt: new Date() })
    .where(eq(auditProjects.id, projectId));
}

function toProjectSummary(row) {
  return {
    id: row.id,
    name: row.name,
    config: row.config,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Masked views: expose existence of a PAT, never the token itself.
function toRepoView(row) {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    nameWithOwner: `${row.owner}/${row.name}`,
    hasPat: !!row.encryptedPat,
    createdAt: row.createdAt,
  };
}
function toBoardView(row) {
  return {
    id: row.id,
    ownerLogin: row.ownerLogin,
    projectNumber: row.projectNumber,
    title: row.title,
    hasPat: !!row.encryptedPat,
    createdAt: row.createdAt,
  };
}

// Collaborator view: prefer the canonical-cased login/name/avatar from the
// linked users row, falling back to the invited login. `pending` means the
// person hasn't signed in yet (no linked account).
function toCollaboratorView(row) {
  return {
    id: row.id,
    login: row.userLogin || row.login,
    name: row.userName || null,
    avatarUrl: row.userAvatar || null,
    role: row.role,
    isOwner: false,
    pending: !row.userId,
    createdAt: row.createdAt,
  };
}

// Super-admin view: prefer canonical-cased identity from the linked users row,
// falling back to the granted login. `pending` means they haven't signed in
// yet; `isSelf` marks the caller so the UI can block removing their own access.
function toSuperAdminView(row, me) {
  return {
    id: row.id,
    login: row.userLogin || row.login,
    name: row.userName || null,
    avatarUrl: row.userAvatar || null,
    pending: !row.userId,
    isSelf: isSelfAdminRow(row, me),
    createdAt: row.createdAt,
  };
}

function isUniqueViolation(e) {
  return e && (e.code === "23505" || /duplicate key value/i.test(e.message || ""));
}
