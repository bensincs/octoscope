#!/usr/bin/env node
/**
 * Operational database helpers.
 *
 * These run from *inside* Azure via the `octoscope-migrate` image (see
 * ../Dockerfile.migrate), because Postgres Flexible Server is only reachable
 * from the Container Apps environment — corporate networks commonly block
 * outbound :5432, and we deliberately do not open firewall rules for laptops.
 *
 * Deliberately dependency-light: uses only `pg`, which is a runtime dependency,
 * so this works in any image that has node_modules installed.
 *
 *   node scripts/db-ops.cjs tables
 *   node scripts/db-ops.cjs seed-admin <github-login>
 *   node scripts/db-ops.cjs rename-table <from> <to>
 *   node scripts/db-ops.cjs ensure-app-role <role> <password>
 *   node scripts/db-ops.cjs verify-app-role
 *
 * Requires DATABASE_URL. `seed-admin` also accepts SEED_LOGIN as a fallback.
 */
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Verify the server certificate rather than merely encrypting. See the note
  // in lib/db/index.js. This job runs before the app rolls out, so it doubles
  // as the canary for the whole deployment: if verification fails here, the
  // deploy stops instead of shipping an app that cannot reach its database.
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 10_000,
});

async function tables() {
  const r = await pool.query(
    "select tablename from pg_tables where schemaname = 'public' order by 1",
  );
  console.log("TABLES: " + r.rows.map((x) => x.tablename).join(", "));
}

async function seedAdmin(arg) {
  const login = String(arg || process.env.SEED_LOGIN || "")
    .trim()
    .toLowerCase();
  if (!login) throw new Error("usage: db-ops.cjs seed-admin <github-login>");

  await pool.query(
    "insert into super_admins (login) values ($1) on conflict (login) do nothing",
    [login],
  );
  // Link the row to an app account if that login has already signed in.
  // Rows with a null user_id are linked automatically on next sign-in.
  await pool.query(
    "update super_admins s set user_id = u.id from users u where lower(u.login) = s.login and s.user_id is null",
  );

  const r = await pool.query(
    "select login, user_id from super_admins order by login",
  );
  console.log("SUPER_ADMINS: " + JSON.stringify(r.rows));
}

/**
 * Rename a table in place, idempotently.
 *
 * `drizzle-kit push` diffs the live database against schema.js. It has no
 * concept of a rename, so renaming a table in schema.js looks like "drop the
 * old one, create a new empty one" — and the job runs push with --force, which
 * auto-approves exactly that. For a parent table like `audit_projects` the drop
 * cascades into repos, boards and collaborators.
 *
 * Running this first means push sees no difference at all.
 *
 *   node scripts/db-ops.cjs rename-table audit_projects projects
 *
 * Safe to re-run: it no-ops once the new name exists, and refuses to clobber an
 * existing destination table.
 */
async function renameTable(from, to) {
  if (!from || !to) {
    throw new Error("usage: db-ops.cjs rename-table <from> <to>");
  }

  const exists = async (name) => {
    const r = await pool.query(
      "select 1 from pg_tables where schemaname = 'public' and tablename = $1",
      [name],
    );
    return r.rowCount > 0;
  };

  const hasFrom = await exists(from);
  const hasTo = await exists(to);

  if (!hasFrom && hasTo) {
    console.log(`RENAME: already done (${from} -> ${to})`);
    return;
  }
  if (!hasFrom && !hasTo) {
    console.log(`RENAME: neither ${from} nor ${to} exists; nothing to do`);
    return;
  }
  if (hasFrom && hasTo) {
    throw new Error(
      `both ${from} and ${to} exist — refusing to guess. Resolve manually.`,
    );
  }

  const before = await pool.query(`select count(*)::int as n from "${from}"`);
  await pool.query(`alter table "${from}" rename to "${to}"`);
  const after = await pool.query(`select count(*)::int as n from "${to}"`);
  console.log(
    `RENAME: ${from} -> ${to} (${before.rows[0].n} rows before, ${after.rows[0].n} after)`,
  );

  // Indexes and constraints keep their old names after a table rename. That is
  // cosmetic for Postgres but push will try to reconcile index names, so bring
  // the obvious ones across too.
  const idx = await pool.query(
    `select indexname from pg_indexes
      where schemaname = 'public' and tablename = $1 and indexname like $2`,
    [to, `${from}%`],
  );
  for (const { indexname } of idx.rows) {
    const renamed = indexname.replace(from, to);
    await pool.query(`alter index "${indexname}" rename to "${renamed}"`);
    console.log(`RENAME INDEX: ${indexname} -> ${renamed}`);
  }
}

/**
 * Create or update a least-privilege role for the application.
 *
 * The app previously connected as the SERVER ADMIN. Because the Postgres
 * firewall has to allow all Azure services (Container Apps consumption has no
 * stable egress IP), that credential is effectively the only thing protecting
 * the database — and it could drop the whole thing. This role can read and
 * write rows and nothing else: no DDL, no role management, no superuser.
 *
 * Migrations keep using the admin account, since they need DDL.
 */
async function ensureAppRole(role, password) {
  const name = String(role || "");
  const pw = String(password || "");

  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error("role must be a lowercase identifier");
  }
  // Role names and passwords cannot be bound as query parameters, so they have
  // to be interpolated. Requiring an alphanumeric password (the deploy script
  // generates hex) removes any escaping question rather than relying on
  // getting quoting right.
  if (!/^[A-Za-z0-9]{24,}$/.test(pw)) {
    throw new Error("app password must be at least 24 alphanumeric characters");
  }

  const { rows } = await pool.query("select current_database() as db");
  const dbName = rows[0].db;

  const exists = await pool.query("select 1 from pg_roles where rolname = $1", [name]);
  if (exists.rowCount === 0) {
    await pool.query(`create role ${name} login password '${pw}'`);
    console.log(`ROLE: created ${name}`);
  } else {
    await pool.query(`alter role ${name} with login password '${pw}'`);
    console.log(`ROLE: updated password for ${name}`);
  }

  await pool.query(`grant connect on database "${dbName}" to ${name}`);
  await pool.query(`grant usage on schema public to ${name}`);
  await pool.query(
    `grant select, insert, update, delete on all tables in schema public to ${name}`,
  );
  await pool.query(
    `grant usage, select on all sequences in schema public to ${name}`,
  );
  // Without default privileges, every future migration would create a table the
  // app cannot touch, and the breakage would only show up at runtime.
  await pool.query(
    `alter default privileges in schema public grant select, insert, update, delete on tables to ${name}`,
  );
  await pool.query(
    `alter default privileges in schema public grant usage, select on sequences to ${name}`,
  );

  console.log(`ROLE: ${name} has DML on public only (no DDL, no superuser)`);
}

/**
 * Prove the connection in DATABASE_URL has exactly the access it should.
 *
 * `select 1` (what /api/health does) passes with no table grants at all, so it
 * cannot tell you whether the application role actually works. This reads real
 * tables and then deliberately attempts DDL, which must FAIL for a correctly
 * restricted role.
 */
async function verifyAppRole() {
  const who = await pool.query("select current_user as u, current_database() as d");
  const { u: user, d: database } = who.rows[0];

  const counts = {};
  for (const table of ["projects", "project_environments", "pull_requests", "adrs"]) {
    const r = await pool.query(`select count(*)::int as n from ${table}`);
    counts[table] = r.rows[0].n;
  }

  let ddl = "denied";
  try {
    await pool.query("create table _octoscope_probe (i int)");
    await pool.query("drop table _octoscope_probe");
    ddl = "ALLOWED";
  } catch (e) {
    ddl = `denied (${e.code})`;
  }

  console.log(
    `VERIFY user=${user} db=${database} reads=${JSON.stringify(counts)} ddl=${ddl}`,
  );
  // FAIL rather than warn. This is a security control, and a warning buried in
  // job logs is not a check — the exit status has to carry the verdict so it
  // can be asserted from a deploy script or CI without reading logs.
  if (ddl === "ALLOWED") {
    throw new Error(
      `${user} can execute DDL — not least privilege. Check the GRANTs.`,
    );
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  tables,
  "seed-admin": () => seedAdmin(rest[0]),
  "rename-table": () => renameTable(rest[0], rest[1]),
  "ensure-app-role": () => ensureAppRole(rest[0], rest[1]),
  "verify-app-role": verifyAppRole,
};
const run = commands[cmd];

if (!run) {
  console.error(
    `unknown command: ${cmd || "(none)"}. expected one of: ${Object.keys(commands).join(", ")}`,
  );
  process.exit(1);
}

run()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
