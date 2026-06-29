# Octoscope

A multi-tenant web app that audits **GitHub issue & repository hygiene** against a
configurable rulebook. Connect repos and Projects v2 boards, define an issue-type
hierarchy, and run read-only audits that surface where issues break your
conventions.

Octoscope is read-only against GitHub — it never modifies your repos, issues, or
boards.

## Features

- **Audit projects** — saved configurations grouping repos + boards under one
  rulebook (issue-type hierarchy, label allow-lists, type aliases).
- **Configurable hierarchy** — e.g. `Epic › Feature › User Story › Task/Bug`;
  validation flags mis-nested or mis-typed issues.
- **GitHub OAuth login** with per-resource **encrypted PATs** (AES-256-GCM) — each
  repo/board carries its own token so access is scoped per resource.
- **Collaborators** — share a project with `viewer` / `editor` / `admin` roles
  (the creator is owner).
- **Super admins** — platform operators with owner-equivalent access to every
  project, managed from the Settings tab.
- **Light + dark** GitHub Primer styling.

## Tech stack

- **Next.js 15** (App Router) + **React 19**
- **NextAuth v5** (GitHub OAuth, scopes: `read:user read:org repo read:project`)
- **PostgreSQL** via **Drizzle ORM**
- **Tailwind CSS v4** + **Primer Octicons**
- **Vitest** for tests
- Deployed to **Azure Container Apps** (IaC: Bicep)

## Getting started

```sh
# 1. Install deps
npm install

# 2. Configure env
cp .env.local.example .env.local   # fill in OAuth + secrets

# 3. Start Postgres (docker)
npm run db:up

# 4. Push the schema
npm run db:push

# 5. Run the app
npm run dev          # http://localhost:3000
```

You'll need a GitHub OAuth app (Settings → Developers) with callback
`http://localhost:3000/api/auth/callback/github`. See `.env.local.example` for all
required variables, including `AUTH_SECRET` and `PAT_ENCRYPTION_KEY`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `start` | Production build / serve |
| `npm test` | Run the Vitest suite |
| `npm run db:up` / `db:down` | Start / stop local Postgres (docker-compose) |
| `npm run db:push` | Apply the Drizzle schema to the DB |
| `npm run db:studio` | Open Drizzle Studio |

## Project layout

- `app/` — Next.js routes (pages + `/api`)
- `components/` — UI; `components/settings/` for the settings panels
- `lib/` — domain logic: `hierarchy` (rulebook), `report` (audit), `crypto`
  (PAT encryption), `access` (roles), `github` (read-only client)
- `lib/db/` — Drizzle schema + data access
- `infra/` — Bicep IaC and deployment guide

## Deployment

Octoscope runs on Azure Container Apps. The image is built in the cloud with
`az acr build` (no local Docker needed) and the schema is applied manually via
`db:push`. Full walkthrough in [`infra/deploy.md`](./infra/deploy.md).

## Security

Read-only on GitHub. PATs are stored encrypted at rest (AES-256-GCM) per repo/board
and decrypted only at audit time. Secrets are kept in `.env.local` (gitignored).
