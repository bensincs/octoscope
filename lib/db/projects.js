// Data-access layer for saved projects.
//
// Access is ROLE-CHECKED. Every project has an OWNER (projects.userId) plus
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

import { and, eq, or, lt, inArray, isNull, asc, sql } from "drizzle-orm";
import { db } from "./index.js";
import {
  users,
  projects,
  issueRepos,
  issueBoards,
  projectCollaborators,
  projectEnvironments,
  pullRequests,
  issueSnapshots,
  adrs,
  superAdmins,
} from "./schema.js";
import { encrypt, decrypt } from "../crypto.js";
import { validateConfig } from "../config.js";
import { DEFAULT_CONFIG } from "../hierarchy.js";
import { isAssignableRole, meetsRole, effectiveRole, isSelfAdminRow } from "../access.js";
import {
  getOpenPullRequests,
  runSavedAudit,
  getRepoFolderMarkdown,
} from "../github.js";
import { adrTitle, sortAdrs, normalizeAdrPath } from "../adrs.js";
import { validateAgentSettings, normalizeBaseUrl } from "../agent.js";
import { validateRetention, isExpired } from "../retention.js";
import {
  validateEnvironment,
  validateClaimNote,
  validateWelcome,
  findNameClash,
  canRelease,
  resolveClaimExpiry,
  isClaimExpired,
} from "../environments.js";

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

/** List the user's projects (owned + shared) with counts (newest first). */
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
    ? or(eq(projects.userId, userId), inArray(projects.id, sharedIds))
    : eq(projects.userId, userId);

  const base = db
    .select({
      id: projects.id,
      userId: projects.userId,
      name: projects.name,
      config: projects.config,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      repoCount: sql`(
        select count(*) from ${issueRepos}
        where ${issueRepos.projectId} = ${projects.id}
      )`.mapWith(Number),
      boardCount: sql`(
        select count(*) from ${issueBoards}
        where ${issueBoards.projectId} = ${projects.id}
      )`.mapWith(Number),
    })
    .from(projects);

  const rows = await (scope ? base.where(scope) : base).orderBy(
    sql`${projects.updatedAt} desc`
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
 * Create a new project. Config defaults to DEFAULT_CONFIG and is always
 * validated/cleaned before persistence.
 */
export async function createProject(userId, { name, config } = {}) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) throw new ValidationError([{ field: "name", message: "Name is required." }]);

  const result = validateConfig(config ?? DEFAULT_CONFIG);
  if (!result.ok) throw new ValidationError(result.errors);

  const [row] = await db
    .insert(projects)
    .values({ userId, name: cleanName, config: result.value })
    .returning();
  return toProjectSummary(row);
}

/** Fetch one project (viewer access) with masked repos + boards + environments. */
export async function getProject(userId, projectId) {
  const { project, role } = await requireAccess(userId, projectId, "viewer");
  const [repos, boards, environments] = await Promise.all([
    db.select().from(issueRepos).where(eq(issueRepos.projectId, projectId)),
    db.select().from(issueBoards).where(eq(issueBoards.projectId, projectId)),
    loadEnvironments(projectId),
  ]);
  return {
    ...toProjectSummary(project),
    viewerRole: role,
    repos: repos.map(toRepoView),
    boards: boards.map(toBoardView),
    environments,
  };
}

/**
 * Fetch a project with DECRYPTED PATs, shaped for runSavedAudit().
 * Server-only — never serialize this to the client.
 */
export async function getProjectForAudit(userId, projectId) {
  const { project } = await requireAccess(userId, projectId, "viewer");
  const [repos, boards] = await Promise.all([
    db.select().from(issueRepos).where(eq(issueRepos.projectId, projectId)),
    db.select().from(issueBoards).where(eq(issueBoards.projectId, projectId)),
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

/**
 * Update a project's name, config and/or welcome page.
 *
 * Name and rulebook need `editor`, matching repos/boards. The welcome page is
 * shown to everyone who can open the project, so authoring it needs `admin` —
 * the same bar as managing who those people are.
 */
export async function updateProject(
  userId,
  projectId,
  {
    name,
    config,
    welcomeMarkdown,
    includeClosedIssues,
    adrRepoId,
    adrPath,
    agentEnabled,
    agentModel,
    agentBaseUrl,
    agentApiKey,
    localOnlyGithubData,
    retentionDays,
  } = {}
) {
  const minRole = welcomeMarkdown !== undefined ? "admin" : "editor";
  await requireAccess(userId, projectId, minRole);

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
  if (welcomeMarkdown !== undefined) {
    const result = validateWelcome(welcomeMarkdown);
    if (!result.ok) throw new ValidationError(result.errors);
    set.welcomeMarkdown = result.value;
  }
  if (includeClosedIssues !== undefined) {
    set.includeClosedIssues = !!includeClosedIssues;
  }
  if (adrRepoId !== undefined) {
    // Empty string clears the selection, which hides the ADR tab.
    set.adrRepoId = adrRepoId || null;
  }
  if (adrPath !== undefined) {
    set.adrPath = normalizeAdrPath(adrPath) || null;
  }
  if (agentEnabled !== undefined) {
    set.agentEnabled = !!agentEnabled;
  }
  if (agentModel !== undefined) {
    set.agentModel = String(agentModel ?? "").trim() || null;
  }
  if (agentBaseUrl !== undefined || agentModel !== undefined) {
    const check = validateAgentSettings({ baseUrl: agentBaseUrl, model: agentModel });
    if (!check.ok) throw new ValidationError(check.errors);
  }
  if (agentBaseUrl !== undefined) {
    set.agentBaseUrl = normalizeBaseUrl(agentBaseUrl) || null;
  }
  if (retentionDays !== undefined) {
    const check = validateRetention(retentionDays);
    if (!check.ok) throw new ValidationError(check.errors);
    set.retentionDays = check.value;
  }
  if (localOnlyGithubData !== undefined) {
    set.localOnlyGithubData = !!localOnlyGithubData;
  }
  if (agentApiKey !== undefined) {
    // Empty string clears the key; anything else is stored encrypted. A key is
    // never echoed back, so the UI sends undefined to leave it untouched.
    const key = String(agentApiKey ?? "").trim();
    set.agentApiKey = key ? encrypt(key) : null;
  }
  if (Object.keys(set).length === 0) {
    return getProject(userId, projectId);
  }

  // Turning local-only ON must delete what is already cached, in the same
  // transaction as the flag. Otherwise the setting would only be true for
  // future refreshes while historical GitHub content sat in the database —
  // a control that reads as enforced but isn't.
  const purging = set.localOnlyGithubData === true;

  await db.transaction(async (tx) => {
    await tx.update(projects).set(set).where(eq(projects.id, projectId));
    if (purging) {
      await tx.delete(issueSnapshots).where(eq(issueSnapshots.projectId, projectId));
      await tx.delete(pullRequests).where(eq(pullRequests.projectId, projectId));
      await tx.delete(adrs).where(eq(adrs.projectId, projectId));
    }
  });

  return getProject(userId, projectId);
}

/** Delete a project (owner only; cascades to repos, boards + collaborators). */
export async function deleteProject(userId, projectId) {
  await requireAccess(userId, projectId, "owner");
  const [row] = await db
    .delete(projects)
    .where(eq(projects.id, projectId))
    .returning({ id: projects.id });
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
      .insert(issueRepos)
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
    .delete(issueRepos)
    .where(and(eq(issueRepos.id, repoId), eq(issueRepos.projectId, projectId)))
    .returning({ id: issueRepos.id });
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
    .update(issueRepos)
    .set({ encryptedPat: encrypt(pat.trim()) })
    .where(and(eq(issueRepos.id, repoId), eq(issueRepos.projectId, projectId)))
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
      .insert(issueBoards)
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
    .delete(issueBoards)
    .where(and(eq(issueBoards.id, boardId), eq(issueBoards.projectId, projectId)))
    .returning({ id: issueBoards.id });
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
    .update(issueBoards)
    .set({ encryptedPat: encrypt(pat.trim()) })
    .where(and(eq(issueBoards.id, boardId), eq(issueBoards.projectId, projectId)))
    .returning();
  if (!row) throw new NotFoundError("Board not found.");
  await touchProject(projectId);
  return toBoardView(row);
}

// ---------------------------------------------------------------------------
// Environments
//
// A project can define named environments (e.g. "staging") that members claim
// to signal they are currently using them. Claims are EXCLUSIVE: the claim is
// stored as columns on the environment row, so an environment physically
// cannot hold two at once — there is no window where two callers both believe
// they hold it.
//
// Defining environments is `editor` (it is project configuration, like repos
// and boards). Claiming is `viewer`, because claiming is coordination between
// members rather than a change to how the project is set up.
// ---------------------------------------------------------------------------

/** List a project's environments with claim details (viewer access). */
export async function listEnvironments(userId, projectId) {
  await requireAccess(userId, projectId, "viewer");
  return loadEnvironments(projectId);
}

/** Define a new environment (editor access). */
export async function addEnvironment(
  userId,
  projectId,
  { name, description } = {}
) {
  await requireAccess(userId, projectId, "editor");

  const result = validateEnvironment({ name, description: description ?? "" });
  if (!result.ok) throw new ValidationError(result.errors);

  await assertNameAvailable(projectId, result.value.name, null);

  try {
    const [row] = await db
      .insert(projectEnvironments)
      .values({
        projectId,
        name: result.value.name,
        description: result.value.description ?? null,
      })
      .returning();
    await touchProject(projectId);
    return toEnvironmentView(row, null);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ValidationError([
        {
          field: "name",
          message: `\u201C${result.value.name}\u201D already exists in this project.`,
        },
      ]);
    }
    throw e;
  }
}

/** Rename or re-describe an environment (editor access). Claims are untouched. */
export async function updateEnvironment(
  userId,
  projectId,
  environmentId,
  { name, description } = {}
) {
  await requireAccess(userId, projectId, "editor");

  const result = validateEnvironment({ name, description });
  if (!result.ok) throw new ValidationError(result.errors);
  const set = { ...result.value };
  if (set.name !== undefined) {
    await assertNameAvailable(projectId, set.name, environmentId);
  }

  if (Object.keys(set).length === 0) {
    const [current] = await loadEnvironments(projectId, environmentId);
    if (!current) throw new NotFoundError("Environment not found.");
    return current;
  }

  const [row] = await db
    .update(projectEnvironments)
    .set(set)
    .where(
      and(
        eq(projectEnvironments.id, environmentId),
        eq(projectEnvironments.projectId, projectId)
      )
    )
    .returning({ id: projectEnvironments.id });
  if (!row) throw new NotFoundError("Environment not found.");
  await touchProject(projectId);
  const [updated] = await loadEnvironments(projectId, environmentId);
  return updated;
}

/** Delete an environment, releasing any claim with it (editor access). */
export async function deleteEnvironment(userId, projectId, environmentId) {
  await requireAccess(userId, projectId, "editor");
  const [row] = await db
    .delete(projectEnvironments)
    .where(
      and(
        eq(projectEnvironments.id, environmentId),
        eq(projectEnvironments.projectId, projectId)
      )
    )
    .returning({ id: projectEnvironments.id });
  if (!row) throw new NotFoundError("Environment not found.");
  await touchProject(projectId);
  return { id: row.id };
}

/**
 * Claim an environment (viewer access).
 *
 * The `isNull(claimedBy)` predicate makes this a compare-and-set: two members
 * racing for the same environment both issue the UPDATE, but only one matches
 * a row. The loser gets a clean "already claimed" error rather than silently
 * stealing it.
 *
 * Claims deliberately do NOT bump the project's updatedAt — that timestamp
 * tracks configuration changes, and claim churn would make every project look
 * permanently modified on the dashboard.
 */
export async function claimEnvironment(
  userId,
  projectId,
  environmentId,
  { note, expiresInHours } = {}
) {
  await requireAccess(userId, projectId, "viewer");

  const noteResult = validateClaimNote(note);
  if (!noteResult.ok) throw new ValidationError(noteResult.errors);

  const expiry = resolveClaimExpiry(expiresInHours);
  if (!expiry.ok) throw new ValidationError(expiry.errors);

  const [row] = await db
    .update(projectEnvironments)
    .set({
      claimedBy: userId,
      claimedAt: new Date(),
      claimExpiresAt: expiry.value,
      claimNote: noteResult.value,
    })
    .where(
      and(
        eq(projectEnvironments.id, environmentId),
        eq(projectEnvironments.projectId, projectId),
        or(
          // Free, lapsed, or already ours — the last case makes re-claiming an
          // extension. Expiry is evaluated by POSTGRES inside the same
          // statement, so this stays a compare-and-set: two people racing for a
          // just-lapsed environment still cannot both win.
          isNull(projectEnvironments.claimedBy),
          lt(projectEnvironments.claimExpiresAt, new Date()),
          eq(projectEnvironments.claimedBy, userId)
        )
      )
    )
    .returning({ id: projectEnvironments.id });

  if (!row) {
    // Either it does not exist, or somebody else holds a live claim.
    const [existing] = await loadEnvironments(projectId, environmentId);
    if (!existing) throw new NotFoundError("Environment not found.");
    throw new ValidationError([
      {
        field: "claim",
        message: `“${existing.name}” is already claimed by ${
          existing.claim?.login || "someone else"
        }.`,
      },
    ]);
  }

  const [claimed] = await loadEnvironments(projectId, environmentId);
  return claimed;
}

/**
 * Release an environment (viewer access).
 *
 * The person holding the claim can always release it. Anyone else needs
 * `admin`, so a forgotten claim can be cleared without waiting for its owner.
 */
export async function releaseEnvironment(userId, projectId, environmentId) {
  const { role } = await requireAccess(userId, projectId, "viewer");

  const [existing] = await loadEnvironments(projectId, environmentId);
  if (!existing) throw new NotFoundError("Environment not found.");
  if (!existing.claim) return existing;

  if (!canRelease({ claim: existing.claim, userId, role }, meetsRole)) {
    throw new ForbiddenError(
      `“${existing.name}” is claimed by ${existing.claim.login}. Only they or a project admin can release it.`
    );
  }

  await db
    .update(projectEnvironments)
    .set({
      claimedBy: null,
      claimedAt: null,
      claimExpiresAt: null,
      claimNote: null,
    })
    .where(
      and(
        eq(projectEnvironments.id, environmentId),
        eq(projectEnvironments.projectId, projectId)
      )
    );

  const [released] = await loadEnvironments(projectId, environmentId);
  return released;
}

// ---------------------------------------------------------------------------
// Pull requests (cached)
//
// The GitHub API is shared and rate-limited, so the open-PR list is fetched
// once and stored, rather than on every page view. Any member can trigger a
// refresh (it is a read against GitHub, not a change to the project) and
// everybody else reads the cached result.
// ---------------------------------------------------------------------------

/** Cached open PRs plus refresh metadata (viewer access). */
export async function listPullRequests(userId, projectId) {
  const { project } = await requireAccess(userId, projectId, "viewer");

  if (project.localOnlyGithubData) {
    return {
      localOnly: true,
      pullRequests: [],
      config: project.config,
      refreshedAt: null,
      refreshedBy: null,
    };
  }

  const rows = await db
    .select({
      id: pullRequests.id,
      number: pullRequests.number,
      title: pullRequests.title,
      url: pullRequests.url,
      authorLogin: pullRequests.authorLogin,
      authorAvatarUrl: pullRequests.authorAvatarUrl,
      isDraft: pullRequests.isDraft,
      checksState: pullRequests.checksState,
      mergeable: pullRequests.mergeable,
      mergeStateStatus: pullRequests.mergeStateStatus,
      prCreatedAt: pullRequests.prCreatedAt,
      prUpdatedAt: pullRequests.prUpdatedAt,
      repoOwner: issueRepos.owner,
      repoName: issueRepos.name,
    })
    .from(pullRequests)
    .innerJoin(issueRepos, eq(pullRequests.repoId, issueRepos.id))
    .where(eq(pullRequests.projectId, projectId));

  if (isExpired(project.prsRefreshedAt, project.retentionDays)) {
    return {
      pullRequests: [],
      config: project.config,
      refreshedAt: null,
      refreshedBy: null,
      expiredByRetention: true,
    };
  }

  return {
    pullRequests: rows.map(toPullRequestView),
    config: project.config,
    refreshedAt: project.prsRefreshedAt ?? null,
    refreshedBy: project.prsRefreshedBy
      ? await loginForUserId(project.prsRefreshedBy)
      : null,
  };
}

/**
 * Re-fetch open PRs from GitHub and replace the cache (viewer access).
 *
 * Each repo is refreshed independently and its rows are swapped in a
 * transaction. A repo whose PAT has expired therefore keeps its previous data
 * and reports an error, instead of a single bad token wiping the whole
 * project's cache — a refresh should never leave you with less than you had.
 */
export async function refreshPullRequests(userId, projectId) {
  const { project } = await requireAccess(userId, projectId, "viewer");

  const repos = await db
    .select()
    .from(issueRepos)
    .where(eq(issueRepos.projectId, projectId));

  if (repos.length === 0) {
    throw new ValidationError([
      { field: "repos", message: "Connect at least one repository first." },
    ]);
  }

  // When local-only is set, nothing is written: the payload is returned for the
  // browser to keep. The GitHub fetch still happens server-side because that is
  // where the PATs are.
  const localOnly = !!project.localOnlyGithubData;

  const errors = [];
  const collected = [];
  let refreshedAny = false;

  for (const repo of repos) {
    const label = `${repo.owner}/${repo.name}`;
    try {
      const prs = await getOpenPullRequests(
        decrypt(repo.encryptedPat),
        repo.owner,
        repo.name
      );

      if (localOnly) {
        for (const pr of prs) {
          collected.push({
            id: `${repo.id}:${pr.number}`,
            number: pr.number,
            title: pr.title,
            url: pr.url,
            authorLogin: pr.authorLogin,
            authorAvatarUrl: pr.authorAvatarUrl,
            isDraft: pr.isDraft,
            checksState: pr.checksState ?? null,
            mergeable: pr.mergeable ?? null,
            mergeStateStatus: pr.mergeStateStatus ?? null,
            prCreatedAt: pr.createdAt ?? null,
            prUpdatedAt: pr.updatedAt ?? null,
            repo: `${repo.owner}/${repo.name}`,
          });
        }
        refreshedAny = true;
        continue;
      }

      await db.transaction(async (tx) => {
        await tx.delete(pullRequests).where(eq(pullRequests.repoId, repo.id));
        if (prs.length) {
          await tx.insert(pullRequests).values(
            prs.map((pr) => ({
              projectId,
              repoId: repo.id,
              number: pr.number,
              title: pr.title,
              url: pr.url,
              authorLogin: pr.authorLogin,
              authorAvatarUrl: pr.authorAvatarUrl,
              isDraft: pr.isDraft,
              checksState: pr.checksState ?? null,
              mergeable: pr.mergeable ?? null,
              mergeStateStatus: pr.mergeStateStatus ?? null,
              prCreatedAt: pr.createdAt ? new Date(pr.createdAt) : null,
              prUpdatedAt: pr.updatedAt ? new Date(pr.updatedAt) : null,
              fetchedAt: new Date(),
            }))
          );
        }
      });
      refreshedAny = true;
    } catch (e) {
      // Never surface the token or raw GitHub payload to the client.
      console.error(`[prs] refresh failed for ${label}:`, e);
      errors.push({ repo: label, message: e.message || "Failed to fetch." });
    }
  }

  if (!refreshedAny) {
    throw new ValidationError(
      errors.length
        ? errors.map((e) => ({ field: "repos", message: `${e.repo}: ${e.message}` }))
        : [{ field: "repos", message: "Refresh failed." }]
    );
  }

  if (localOnly) {
    const me = await getUserCtx(userId);
    return {
      localOnly: true,
      pullRequests: collected,
      config: project.config,
      refreshedAt: new Date(),
      refreshedBy: me?.login ?? null,
      errors,
    };
  }

  // Only stamp the timestamp when something actually came back, so the age
  // shown in the UI can't claim data is fresher than it is.
  await db
    .update(projects)
    .set({ prsRefreshedAt: new Date(), prsRefreshedBy: userId })
    .where(eq(projects.id, projectId));

  const result = await listPullRequests(userId, projectId);
  return { ...result, errors };
}

// ---------------------------------------------------------------------------
// Issues (cached audit snapshot)
//
// Auditing hits the GitHub API once per repo and per board, so the result is
// computed once and shared rather than re-run for every viewer. Any member can
// refresh; everybody else reads the snapshot.
// ---------------------------------------------------------------------------

/**
 * The cached issue snapshot for a project (viewer access).
 *
 * The snapshot stores the RAW issues fetched from GitHub. The rulebook is
 * applied at render time against `config` below, so editing a rule takes effect
 * immediately with no refetch and the cache can never disagree with the current
 * rulebook.
 *
 * `includeClosed` is the one setting that CAN drift, and is reported as such:
 * closed issues genuinely aren't in the cache, so switching it on does require
 * going back to GitHub.
 */
export async function getIssueSnapshot(userId, projectId) {
  const { project } = await requireAccess(userId, projectId, "viewer");

  const [snap] = await db
    .select()
    .from(issueSnapshots)
    .where(eq(issueSnapshots.projectId, projectId))
    .limit(1);

  if (project.localOnlyGithubData) {
    return {
      localOnly: true,
      result: null,
      config: project.config,
      refreshedAt: null,
      refreshedBy: null,
      includeClosed: project.includeClosedIssues,
      issueCount: 0,
      includeClosedChanged: false,
    };
  }

  // Expired data is not served, even before the sweeper deletes it. Waiting
  // for a scheduled job would mean the policy is true only once a day.
  if (snap && isExpired(snap.refreshedAt, project.retentionDays)) {
    return {
      result: null,
      config: project.config,
      refreshedAt: null,
      refreshedBy: null,
      includeClosed: project.includeClosedIssues,
      issueCount: 0,
      includeClosedChanged: false,
      expiredByRetention: true,
    };
  }

  if (!snap) {
    return {
      result: null,
      config: project.config,
      refreshedAt: null,
      refreshedBy: null,
      includeClosed: project.includeClosedIssues,
      issueCount: 0,
      includeClosedChanged: false,
    };
  }

  return {
    result: snap.result,
    // The CURRENT rulebook, not the one in force at refresh time.
    config: project.config,
    refreshedAt: snap.refreshedAt,
    refreshedBy: snap.refreshedBy ? await loginForUserId(snap.refreshedBy) : null,
    includeClosed: snap.includeClosed,
    issueCount: snap.issueCount,
    includeClosedChanged: snap.includeClosed !== project.includeClosedIssues,
  };
}

/**
 * Re-run the audit against GitHub and replace the snapshot (viewer access).
 *
 * Unlike pull requests, this is all-or-nothing: the audit aggregates repos and
 * boards into a single tree, so a partial result would be a misleading tree
 * rather than a shorter list. Per-repo failures come back as `warnings` inside
 * the payload, which is how runSavedAudit already reports them.
 */
export async function refreshIssues(userId, projectId) {
  await requireAccess(userId, projectId, "viewer");

  const project = await getProjectForAudit(userId, projectId);
  if (project.repos.length === 0) {
    throw new ValidationError([
      { field: "repos", message: "Connect at least one repository first." },
    ]);
  }

  const [row] = await db
    .select({
      includeClosed: projects.includeClosedIssues,
      config: projects.config,
      localOnlyGithubData: projects.localOnlyGithubData,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const includeClosed = !!row?.includeClosed;

  const audit = await runSavedAudit({
    repos: project.repos,
    boards: project.boards,
    includeClosed,
  });

  const result = {
    project: { id: project.id, name: project.name },
    config: project.config,
    issues: audit.issues,
    repos: audit.repos,
    boards: audit.boards,
    projectActive: audit.projectActive,
    warnings: audit.warnings,
  };

  if (row?.localOnlyGithubData) {
    const me = await getUserCtx(userId);
    return {
      localOnly: true,
      result,
      config: project.config,
      refreshedAt: new Date(),
      refreshedBy: me?.login ?? null,
      includeClosed,
      issueCount: audit.issues.length,
      includeClosedChanged: false,
    };
  }

  const values = {
    projectId,
    result,
    configUsed: project.config,
    includeClosed,
    issueCount: audit.issues.length,
    refreshedBy: userId,
    refreshedAt: new Date(),
  };

  await db
    .insert(issueSnapshots)
    .values(values)
    .onConflictDoUpdate({
      target: issueSnapshots.projectId,
      set: {
        result: values.result,
        configUsed: values.configUsed,
        includeClosed: values.includeClosed,
        issueCount: values.issueCount,
        refreshedBy: values.refreshedBy,
        refreshedAt: values.refreshedAt,
      },
    });

  return getIssueSnapshot(userId, projectId);
}

// ---------------------------------------------------------------------------
// Architecture Decision Records (cached)
//
// Same shape as pull requests: one member refreshes from GitHub, everybody
// reads the cache. Bodies are stored so an ADR renders in-app without a fetch
// per view.
// ---------------------------------------------------------------------------

/** Cached ADRs plus refresh metadata (viewer access). */
export async function listAdrs(userId, projectId) {
  const { project } = await requireAccess(userId, projectId, "viewer");

  if (project.localOnlyGithubData) {
    const [repo] = project.adrRepoId
      ? await db
          .select({ owner: issueRepos.owner, name: issueRepos.name })
          .from(issueRepos)
          .where(eq(issueRepos.id, project.adrRepoId))
          .limit(1)
      : [];
    return {
      localOnly: true,
      adrs: [],
      source: repo ? { repo: `${repo.owner}/${repo.name}`, path: project.adrPath } : null,
      refreshedAt: null,
      refreshedBy: null,
    };
  }

  const rows = await db
    .select()
    .from(adrs)
    .where(eq(adrs.projectId, projectId));

  const [repo] = project.adrRepoId
    ? await db
        .select({ owner: issueRepos.owner, name: issueRepos.name })
        .from(issueRepos)
        .where(eq(issueRepos.id, project.adrRepoId))
        .limit(1)
    : [];

  if (isExpired(project.adrsRefreshedAt, project.retentionDays)) {
    return {
      adrs: [],
      source: repo ? { repo: `${repo.owner}/${repo.name}`, path: project.adrPath } : null,
      refreshedAt: null,
      refreshedBy: null,
      expiredByRetention: true,
    };
  }

  return {
    adrs: sortAdrs(rows.map(toAdrView)),
    // Echoed back so the UI can explain what is (or isn't) configured.
    source: repo ? { repo: `${repo.owner}/${repo.name}`, path: project.adrPath } : null,
    refreshedAt: project.adrsRefreshedAt ?? null,
    refreshedBy: project.adrsRefreshedBy
      ? await loginForUserId(project.adrsRefreshedBy)
      : null,
  };
}

/**
 * Re-read the ADR folder from GitHub and replace the cache (viewer access).
 *
 * Replaced wholesale rather than merged: a record deleted upstream must
 * disappear here too, and there is only ever one source folder, so there is no
 * partial-failure case to preserve as there is with multi-repo pull requests.
 */
export async function refreshAdrs(userId, projectId) {
  await requireAccess(userId, projectId, "viewer");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const path = normalizeAdrPath(project?.adrPath);
  if (!project?.adrRepoId || !path) {
    throw new ValidationError([
      { field: "adrPath", message: "Choose a repository and folder in Settings first." },
    ]);
  }

  const [repo] = await db
    .select()
    .from(issueRepos)
    .where(
      and(eq(issueRepos.id, project.adrRepoId), eq(issueRepos.projectId, projectId))
    )
    .limit(1);
  if (!repo) {
    throw new ValidationError([
      { field: "adrRepoId", message: "That repository is no longer connected." },
    ]);
  }

  const result = await getRepoFolderMarkdown(
    decrypt(repo.encryptedPat),
    repo.owner,
    repo.name,
    path
  );

  if (!result.found) {
    throw new ValidationError([
      {
        field: "adrPath",
        message: `“${path}” doesn't exist in ${repo.owner}/${repo.name}.`,
      },
    ]);
  }

  if (project.localOnlyGithubData) {
    const me = await getUserCtx(userId);
    return {
      localOnly: true,
      adrs: sortAdrs(
        result.files.map((f) => ({
          id: f.path,
          path: f.path,
          fileName: f.name,
          title: adrTitle(f.name, f.body),
          body: f.body,
          url: f.url,
          lastModifiedAt: f.lastModifiedAt ?? null,
        })),
      ),
      source: { repo: `${repo.owner}/${repo.name}`, path },
      refreshedAt: new Date(),
      refreshedBy: me?.login ?? null,
    };
  }

  const rows = result.files.map((f) => ({
    projectId,
    path: f.path,
    fileName: f.name,
    title: adrTitle(f.name, f.body),
    body: f.body,
    url: f.url,
    lastModifiedAt: f.lastModifiedAt ? new Date(f.lastModifiedAt) : null,
    fetchedAt: new Date(),
  }));

  await db.transaction(async (tx) => {
    await tx.delete(adrs).where(eq(adrs.projectId, projectId));
    if (rows.length) await tx.insert(adrs).values(rows);
    await tx
      .update(projects)
      .set({ adrsRefreshedAt: new Date(), adrsRefreshedBy: userId })
      .where(eq(projects.id, projectId));
  });

  return listAdrs(userId, projectId);
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
    // Match on linked id OR login. `user_id` is only populated when the row is
    // linked, and a login seeded before that person ever signed in stays null
    // until something backfills it — joining on id alone reported people who
    // have signed in as still "pending".
    .leftJoin(
      users,
      or(
        eq(users.id, superAdmins.userId),
        eq(sql`lower(${users.login})`, superAdmins.login)
      )
    )
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
    .from(projects)
    .where(eq(projects.id, projectId))
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
    .update(projects)
    .set({ updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

function toProjectSummary(row) {
  return {
    id: row.id,
    name: row.name,
    config: row.config,
    // Null when unset. The Welcome tab keys off this being non-empty.
    welcomeMarkdown: row.welcomeMarkdown ?? null,
    includeClosedIssues: !!row.includeClosedIssues,
    adrRepoId: row.adrRepoId ?? null,
    adrPath: row.adrPath ?? null,
    localOnlyGithubData: !!row.localOnlyGithubData,
    retentionDays: row.retentionDays ?? null,
    agentEnabled: !!row.agentEnabled,
    agentModel: row.agentModel ?? null,
    agentBaseUrl: row.agentBaseUrl ?? null,
    // Existence only — the key itself never leaves the server.
    agentHasApiKey: !!row.agentApiKey,
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

/**
 * Read a project's environments (optionally just one), joined to the claiming
 * user so the UI can show who holds each one. Left join: an unclaimed
 * environment still comes back, with a null user.
 */
async function loadEnvironments(projectId, environmentId = null) {
  const where = environmentId
    ? and(
        eq(projectEnvironments.projectId, projectId),
        eq(projectEnvironments.id, environmentId)
      )
    : eq(projectEnvironments.projectId, projectId);

  const rows = await db
    .select({
      id: projectEnvironments.id,
      name: projectEnvironments.name,
      description: projectEnvironments.description,
      claimedBy: projectEnvironments.claimedBy,
      claimedAt: projectEnvironments.claimedAt,
      claimExpiresAt: projectEnvironments.claimExpiresAt,
      claimNote: projectEnvironments.claimNote,
      createdAt: projectEnvironments.createdAt,
      claimantLogin: users.login,
      claimantName: users.name,
      claimantAvatarUrl: users.avatarUrl,
    })
    .from(projectEnvironments)
    .leftJoin(users, eq(projectEnvironments.claimedBy, users.id))
    .where(where)
    .orderBy(asc(projectEnvironments.name));

  // A lapsed claim reads as available. Evaluated here rather than swept by a
  // job: nothing to schedule, nothing to fail silently and leave environments
  // locked.
  return rows.map((r) => {
    const live =
      r.claimedBy && !isClaimExpired({ expiresAt: r.claimExpiresAt });
    return toEnvironmentView(r, live ? r : null);
  });
}

/**
 * Reject a name that collides with an existing environment case-insensitively.
 *
 * The unique index only catches exact duplicates, but "Staging" and "staging"
 * are the same environment as far as a human is concerned. Pass the id being
 * updated so an environment doesn't collide with itself.
 */
async function assertNameAvailable(projectId, name, excludeId) {
  const rows = await db
    .select({ id: projectEnvironments.id, name: projectEnvironments.name })
    .from(projectEnvironments)
    .where(eq(projectEnvironments.projectId, projectId));

  const clash = findNameClash(rows, name, excludeId);
  if (clash) {
    throw new ValidationError([
      {
        field: "name",
        message: `\u201C${clash.name}\u201D already exists in this project.`,
      },
    ]);
  }
}

/** GitHub login for an app user id, or null. Used for "refreshed by". */
async function loginForUserId(userId) {
  if (!userId) return null;
  const [row] = await db
    .select({ login: users.login })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.login ?? null;
}

function toAdrView(row) {
  return {
    id: row.id,
    path: row.path,
    fileName: row.fileName,
    title: row.title,
    body: row.body,
    url: row.url,
    lastModifiedAt: row.lastModifiedAt,
  };
}

function toPullRequestView(row) {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    url: row.url,
    authorLogin: row.authorLogin,
    authorAvatarUrl: row.authorAvatarUrl,
    isDraft: row.isDraft,
    checksState: row.checksState,
    mergeable: row.mergeable,
    mergeStateStatus: row.mergeStateStatus,
    prCreatedAt: row.prCreatedAt,
    prUpdatedAt: row.prUpdatedAt,
    repo: `${row.repoOwner}/${row.repoName}`,
  };
}

// Environment view. `claim` is null when free, otherwise identifies the holder.
function toEnvironmentView(row, claimant) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    claim: claimant
      ? {
          userId: row.claimedBy,
          login: claimant.claimantLogin ?? null,
          name: claimant.claimantName ?? null,
          avatarUrl: claimant.claimantAvatarUrl ?? null,
          claimedAt: row.claimedAt,
          expiresAt: row.claimExpiresAt ?? null,
          note: row.claimNote ?? null,
        }
      : null,
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
    // "Pending" means no app account exists for this login yet — not merely
    // that the user_id column hasn't been backfilled.
    pending: !row.userLogin,
    isSelf: isSelfAdminRow(row, me),
    createdAt: row.createdAt,
  };
}

function isUniqueViolation(e) {
  return e && (e.code === "23505" || /duplicate key value/i.test(e.message || ""));
}
