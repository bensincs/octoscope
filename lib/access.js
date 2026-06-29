// Pure role / access-control helpers shared by the data-access layer.
//
// A project has an OWNER plus collaborators with a role:
//   viewer  — open the project and run audits
//   editor  — viewer + edit name/rulebook and manage repos/boards
//   admin   — editor + manage collaborators
//   owner   — admin + delete the project (implicit, never a collaborator row)
//
// These helpers contain NO database access so they can be unit-tested in
// isolation and reused wherever a role decision is needed.

// Roles assignable to a collaborator row (owner is implicit, never assignable).
export const ROLES = ["viewer", "editor", "admin"];

// Comparable ranks; higher means more capable.
export const ROLE_RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };

/** Is `role` a role that can be stored on a collaborator row? */
export function isAssignableRole(role) {
  return ROLES.includes(role);
}

/** Does `role` meet or exceed `minRole`? Unknown roles never satisfy. */
export function meetsRole(role, minRole) {
  const have = ROLE_RANK[role];
  const need = ROLE_RANK[minRole];
  if (!have || !need) return false;
  return have >= need;
}

/**
 * Resolve a caller's effective role on a project from the three facts the data
 * layer knows about them:
 *   isOwner      — they own the project row (auditProjects.userId)
 *   collabRole   — their collaborator role on this project, or null
 *   isSuperAdmin — they are a platform super admin (global, owner-equivalent)
 *
 * Owners and super admins are owner-equivalent; otherwise the collaborator role
 * applies; otherwise null (no access at all).
 */
export function effectiveRole({
  isOwner = false,
  collabRole = null,
  isSuperAdmin = false,
} = {}) {
  if (isOwner || isSuperAdmin) return "owner";
  return collabRole ?? null;
}

/**
 * Does a super_admins row identify the given user? Matched by linked userId or,
 * failing that, by (case-insensitive) GitHub login. Used to block a super admin
 * from removing their own access (lockout guard) and to mark "you" in the UI.
 */
export function isSelfAdminRow(row, me) {
  if (!row || !me) return false;
  if (row.userId && me.id && row.userId === me.id) return true;
  if (me.login && row.login)
    return String(me.login).toLowerCase() === String(row.login).toLowerCase();
  return false;
}
