import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Users — owners of saved audit projects. Identified via GitHub OAuth.
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
 * Audit projects — an app-owned configuration grouping repos + boards under a
 * single hygiene rulebook (issue types, hierarchy levels, allowed labels).
 */
export const auditProjects = pgTable(
  "audit_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Rulebook config: { levels, aliases, allowedLabels, enforceLabels, ... }
    config: jsonb("config").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("audit_projects_user_idx").on(t.userId),
  })
);

/**
 * Collaborators on an audit project. The project's `userId` is the implicit
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
      .references(() => auditProjects.id, { onDelete: "cascade" }),
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
 * audit project, regardless of ownership or collaborator membership. This is a
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

export const auditRepos = pgTable(
  "audit_repos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => auditProjects.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    encryptedPat: text("encrypted_pat").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectIdx: index("audit_repos_project_idx").on(t.projectId),
    // owner/name are stored lowercased (GitHub is case-insensitive) so a plain
    // unique index prevents duplicate repos within a project.
    repoUnique: uniqueIndex("audit_repos_unique").on(
      t.projectId,
      t.owner,
      t.name
    ),
  })
);

/**
 * GitHub Projects v2 boards belonging to an audit project. Each carries its
 * OWN encrypted PAT.
 */
export const auditBoards = pgTable(
  "audit_boards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => auditProjects.id, { onDelete: "cascade" }),
    ownerLogin: text("owner_login").notNull(),
    projectNumber: integer("project_number").notNull(),
    title: text("title"),
    encryptedPat: text("encrypted_pat").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectIdx: index("audit_boards_project_idx").on(t.projectId),
    // ownerLogin is stored lowercased; one board per (owner, number) per project.
    boardUnique: uniqueIndex("audit_boards_unique").on(
      t.projectId,
      t.ownerLogin,
      t.projectNumber
    ),
  })
);
