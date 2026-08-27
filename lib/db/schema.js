import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Users — owners of saved projects. Identified via GitHub OAuth.
 * GitHub data access is NOT done with the OAuth token; it uses per-resource
 * PATs stored (encrypted) on repos/boards.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    githubId: text("github_id").notNull(),
    login: text("login").notNull(),
    name: text("name"),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    githubIdUnique: uniqueIndex("users_github_id_unique").on(t.githubId),
  })
);

/**
 * Projects — an app-owned workspace grouping repos + boards under a single
 * hygiene rulebook (issue types, hierarchy levels, allowed labels), plus
 * optional claimable environments and a welcome page.
 *
 * NOTE: this table was originally named `audit_projects`. It is renamed in
 * place with `node scripts/db-ops.cjs rename-table audit_projects projects`
 * BEFORE `drizzle-kit push` runs — push would otherwise see an unknown table
 * plus a missing one and drop/recreate, cascading away every repo, board and
 * collaborator.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Rulebook config: { levels, aliases, allowedLabels, enforceLabels, ... }
    config: jsonb("config").notNull(),
    // Optional markdown welcome page, editable by project admins. While this is
    // null/empty the Welcome tab is hidden entirely.
    welcomeMarkdown: text("welcome_markdown"),
    // Whether issue refreshes include closed issues. A project-level setting
    // rather than a per-run toggle, because the snapshot is shared: two people
    // must not disagree about what the cached numbers mean.
    includeClosedIssues: boolean("include_closed_issues")
      .notNull()
      .default(false),
    // Architecture Decision Records: which connected repo holds them and the
    // folder within it. Both must be set for the ADR tab to appear.
    // SET NULL rather than cascade — removing the repo should unconfigure ADRs,
    // not delete the project.
    adrRepoId: uuid("adr_repo_id").references(() => issueRepos.id, {
      onDelete: "set null",
    }),
    adrPath: text("adr_path"),
    adrsRefreshedAt: timestamp("adrs_refreshed_at", { withTimezone: true }),
    adrsRefreshedBy: uuid("adrs_refreshed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // Agent tab, backed by any OpenAI-compatible endpoint. Configured per
    // project: an API key is billed by usage rather than licensed to a person,
    // so an admin providing one for their team is a normal arrangement.
    agentEnabled: boolean("agent_enabled").notNull().default(false),
    agentModel: text("agent_model"),
    agentBaseUrl: text("agent_base_url"),
    // Encrypted with the same AES-256-GCM key as repository PATs. Never
    // returned to the client — reads report only whether one is set.
    agentApiKey: text("agent_api_key"),
    // When the cached pull-request list was last refreshed, and by whom. The
    // cache is shared, so one person refreshing serves everybody.
    prsRefreshedAt: timestamp("prs_refreshed_at", { withTimezone: true }),
    prsRefreshedBy: uuid("prs_refreshed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("projects_user_idx").on(t.userId),
  })
);

/**
 * Claimable environments belonging to a project (e.g. "dev", "staging",
 * "prod-uk"). Members claim one to signal they are currently using it.
 *
 * Exclusivity is structural rather than enforced by application logic: the
 * claim lives in columns on the environment row itself, so an environment
 * cannot physically hold two simultaneous claims. `claimedBy` is SET NULL (not
 * cascade) on user deletion — losing a user should free the environment, not
 * delete it.
 */
export const projectEnvironments = pgTable(
  "project_environments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    claimedBy: uuid("claimed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    // Null means the claim never expires. A claim past this instant is treated
    // as free at read time — no sweeper job, so nothing can silently stop
    // running and leave environments locked forever.
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    claimNote: text("claim_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectIdx: index("project_environments_project_idx").on(t.projectId),
    claimedByIdx: index("project_environments_claimed_by_idx").on(t.claimedBy),
    // Name is stored as typed (case matters for display), so this index only
    // catches exact duplicates. The data layer additionally rejects names that
    // differ only by case, which is what users actually expect.
    envUnique: uniqueIndex("project_environments_unique").on(
      t.projectId,
      t.name
    ),
  })
);

/**
 * Collaborators on a project. The project's `userId` is the implicit
 * OWNER (always full access, never stored here). Each row grants a non-owner
 * user a role:
 *   - "viewer"  — open the project and run audits
 *   - "editor"  — viewer + edit rulebook/name and manage repos/boards
 *   - "admin"   — editor + manage collaborators
 *
 * A collaborator is invited by GitHub `login` (stored lowercased). If that
 * person already has an app account we link `userId`; otherwise it stays null
 * (a pending invite) and is matched by login the next time they sign in.
 */
export const projectCollaborators = pgTable(
  "project_collaborators",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    login: text("login").notNull(),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectIdx: index("project_collaborators_project_idx").on(t.projectId),
    userIdx: index("project_collaborators_user_idx").on(t.userId),
    // One collaborator entry per (project, login).
    collabUnique: uniqueIndex("project_collaborators_unique").on(
      t.projectId,
      t.login
    ),
  })
);

/**
 * Super admins — platform operators with owner-equivalent access to EVERY
 * project, regardless of ownership or collaborator membership. This is a
 * global role, not scoped to a project.
 *
 * Like collaborators, a super admin is keyed by GitHub `login` (stored
 * lowercased). If that login already has an app account we link `userId`;
 * otherwise it stays null and is matched by login on their next sign-in.
 *
 * The FIRST super admin is seeded manually with SQL against the database (see
 * infra/deploy.md); thereafter super admins manage each other from the UI.
 */
export const superAdmins = pgTable(
  "super_admins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    login: text("login").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userIdx: index("super_admins_user_idx").on(t.userId),
    // One entry per login.
    loginUnique: uniqueIndex("super_admins_login_unique").on(t.login),
  })
);

export const issueRepos = pgTable(
  "issue_repos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    encryptedPat: text("encrypted_pat").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectIdx: index("issue_repos_project_idx").on(t.projectId),
    // owner/name are stored lowercased (GitHub is case-insensitive) so a plain
    // unique index prevents duplicate repos within a project.
    repoUnique: uniqueIndex("issue_repos_unique").on(
      t.projectId,
      t.owner,
      t.name
    ),
  })
);

/**
 * GitHub Projects v2 boards belonging to a project. Each carries its
 * OWN encrypted PAT.
 *
 * Renamed from `audit_boards`; see the note on `projects` for why renames go
 * through db-ops rename-table rather than drizzle push.
 */
export const issueBoards = pgTable(
  "issue_boards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ownerLogin: text("owner_login").notNull(),
    projectNumber: integer("project_number").notNull(),
    title: text("title"),
    encryptedPat: text("encrypted_pat").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectIdx: index("issue_boards_project_idx").on(t.projectId),
    // ownerLogin is stored lowercased; one board per (owner, number) per project.
    boardUnique: uniqueIndex("issue_boards_unique").on(
      t.projectId,
      t.ownerLogin,
      t.projectNumber
    ),
  })
);

/**
 * Cached open pull requests for a project's connected repositories.
 *
 * This is a CACHE, not a source of truth: it is replaced wholesale per repo on
 * each refresh, and nothing here is authoritative. It exists so that opening
 * the Pull requests tab doesn't hit the GitHub API — a shared, rate-limited
 * resource — once per viewer. One person presses Refresh; everyone reads the
 * result.
 *
 * Rows are keyed by (repo, number) rather than by GitHub's node id so that a
 * repo being re-added doesn't orphan its cached rows.
 */
export const pullRequests = pgTable(
  "pull_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => issueRepos.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    // Nullable: a PR opened by a deleted account has no author.
    authorLogin: text("author_login"),
    authorAvatarUrl: text("author_avatar_url"),
    isDraft: boolean("is_draft").notNull().default(false),
    // Health signals used by the pull-request rulebook. All nullable/UNKNOWN
    // tolerant: GitHub computes merge state lazily and a null rollup just means
    // the PR has no checks configured.
    checksState: text("checks_state"),
    mergeable: text("mergeable"),
    mergeStateStatus: text("merge_state_status"),
    // Timestamps from GitHub, distinct from this row's own fetchedAt.
    prCreatedAt: timestamp("pr_created_at", { withTimezone: true }),
    prUpdatedAt: timestamp("pr_updated_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectIdx: index("pull_requests_project_idx").on(t.projectId),
    repoIdx: index("pull_requests_repo_idx").on(t.repoId),
    authorIdx: index("pull_requests_author_idx").on(t.authorLogin),
    prUnique: uniqueIndex("pull_requests_unique").on(t.repoId, t.number),
  })
);

/**
 * Cached issue-audit result for a project — one row per project.
 *
 * Held in its own table rather than as a column on `projects` because the
 * payload is large (every issue, with its hierarchy) and `projects` is read on
 * essentially every request. Nobody should pay to deserialize a snapshot just
 * to render a tab bar.
 *
 * `result` holds the RAW issues fetched from GitHub, not a computed tree. The
 * rulebook is applied at render time against the project's current config, so
 * editing a rule takes effect immediately and the cache can never disagree with
 * the rulebook. `configUsed` is kept purely as provenance — what the rulebook
 * looked like when this was fetched — and is not used for rendering.
 *
 * `includeClosed` is the one setting that genuinely invalidates the cache:
 * closed issues aren't in it, so enabling them requires another fetch.
 */
export const issueSnapshots = pgTable(
  "issue_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // The full audit payload the client renders.
    result: jsonb("result").notNull(),
    // Rulebook in force when this was computed, for drift detection.
    configUsed: jsonb("config_used").notNull(),
    includeClosed: boolean("include_closed").notNull().default(false),
    issueCount: integer("issue_count").notNull().default(0),
    refreshedBy: uuid("refreshed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    // One snapshot per project: a refresh replaces it.
    projectUnique: uniqueIndex("issue_snapshots_project_unique").on(t.projectId),
  })
);

/**
 * Cached Architecture Decision Records from a project's chosen repo folder.
 *
 * Like `pull_requests`, this is a CACHE replaced wholesale on refresh — the
 * repository remains the source of truth. Bodies are stored so an ADR can be
 * read in-app without a round trip to GitHub per view.
 */
export const adrs = pgTable(
  "adrs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Path within the repo, unique per project and stable across refreshes.
    path: text("path").notNull(),
    fileName: text("file_name").notNull(),
    // First markdown heading, falling back to a prettified file name.
    title: text("title").notNull(),
    body: text("body"),
    url: text("url"),
    // Last commit date for this file, not the row's fetch time.
    lastModifiedAt: timestamp("last_modified_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectIdx: index("adrs_project_idx").on(t.projectId),
    adrUnique: uniqueIndex("adrs_unique").on(t.projectId, t.path),
  })
);

