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
 *   node scripts/db-ops.cjs preflight
 *   node scripts/db-ops.cjs verify-schema
 *   node scripts/db-ops.cjs purge-expired
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

// ---------------------------------------------------------------------------
// Schema shape checks
//
// `drizzle-kit push` cannot be trusted to report what it did. Without --force
// it prompts, and with stdin closed it takes the default and EXITS 0 WITHOUT
// APPLYING ANYTHING — a schema change that silently doesn't happen, reported as
// success. That shipped a release whose code selected a column the database
// didn't have.
//
// So the guard moved out of drizzle: `preflight` decides whether the change is
// destructive (and refuses unless ALLOW_DATA_LOSS is set), push always runs
// with --force so it actually applies, and `verify-schema` asserts afterwards
// that the database really does match. Trust the outcome, not the exit code.
// ---------------------------------------------------------------------------

/** Tables and columns as declared in lib/db/schema.js. */
async function expectedShape() {
  const { pathToFileURL } = require("node:url");
  const { resolve } = require("node:path");
  const schemaUrl = pathToFileURL(resolve(__dirname, "../lib/db/schema.js")).href;

  const [schema, pgCore] = await Promise.all([
    import(schemaUrl),
    import("drizzle-orm/pg-core"),
  ]);
  const { getTableConfig } = pgCore;

  const tables = new Map();
  for (const value of Object.values(schema)) {
    let cfg;
    try {
      cfg = getTableConfig(value);
    } catch {
      continue; // not a pgTable export
    }
    tables.set(
      cfg.name,
      new Map(cfg.columns.map((c) => [c.name, normalizeType(c.getSQLType())])),
    );
  }
  return tables;
}

/**
 * Reduce a Postgres type to a comparable form.
 *
 * drizzle's getSQLType() and information_schema.data_type already agree on the
 * types this schema uses ("uuid", "jsonb", "timestamp with time zone"), so this
 * only smooths over the aliases either side might produce. Anything unrecognised
 * passes through unchanged and is compared literally.
 */
function normalizeType(type) {
  const t = String(type ?? "").toLowerCase().trim();
  const aliases = {
    timestamptz: "timestamp with time zone",
    timestamp: "timestamp without time zone",
    "character varying": "varchar",
    int4: "integer",
    int8: "bigint",
    int2: "smallint",
    bool: "boolean",
    float8: "double precision",
  };
  // Length/precision qualifiers are not something push changes on its own.
  const bare = t.replace(/\(.*\)$/, "").trim();
  return aliases[bare] ?? bare;
}

/** Tables and columns actually present in the database. */
async function liveShape() {
  const { rows } = await pool.query(
    `select table_name, column_name, data_type
       from information_schema.columns
      where table_schema = 'public'`,
  );
  const tables = new Map();
  for (const r of rows) {
    if (!tables.has(r.table_name)) tables.set(r.table_name, new Map());
    tables.get(r.table_name).set(r.column_name, normalizeType(r.data_type));
  }
  return tables;
}

function diffShapes(expected, live) {
  const additive = [];
  const destructive = [];

  for (const [table, cols] of expected) {
    if (!live.has(table)) {
      additive.push(`create table ${table}`);
      continue;
    }
    for (const [col, type] of cols) {
      const liveType = live.get(table).get(col);
      if (liveType === undefined) {
        additive.push(`add ${table}.${col}`);
      } else if (liveType !== type) {
        // A type change rewrites every value in the column and can lose data
        // silently — jsonb to text is reversible, text to integer is not.
        // Presence checks alone would wave this through.
        destructive.push(`ALTER ${table}.${col} ${liveType} -> ${type}`);
      }
    }
  }
  for (const [table, cols] of live) {
    if (!expected.has(table)) {
      destructive.push(`DROP TABLE ${table}`);
      continue;
    }
    for (const col of cols.keys()) {
      if (!expected.get(table).has(col)) destructive.push(`DROP ${table}.${col}`);
    }
  }
  return { additive, destructive };
}

/** Refuse to push a destructive change unless it was asked for explicitly. */
async function preflight() {
  const { additive, destructive } = diffShapes(await expectedShape(), await liveShape());

  for (const change of additive) console.log(`PREFLIGHT additive: ${change}`);
  for (const change of destructive) console.log(`PREFLIGHT destructive: ${change}`);
  if (additive.length === 0 && destructive.length === 0) {
    console.log("PREFLIGHT: no schema changes");
  }

  if (destructive.length > 0 && !process.env.ALLOW_DATA_LOSS) {
    throw new Error(
      `${destructive.length} destructive change(s) would run. Set ALLOW_DATA_LOSS=true for this deployment only if that is intended.`,
    );
  }
}

/** Assert the database matches the schema. Fails if push silently did nothing. */
async function verifySchema() {
  const { additive } = diffShapes(await expectedShape(), await liveShape());
  if (additive.length > 0) {
    throw new Error(
      `schema was NOT applied: still missing ${additive.join(", ")}`,
    );
  }
  console.log("VERIFY SCHEMA: database matches schema.js");
}

/**
 * Delete GitHub-derived data past each project's retention period.
 *
 * Reads already refuse to serve expired data, so this is what makes the policy
 * real rather than cosmetic — without it the rows would sit in the database
 * indefinitely while the UI pretended they were gone.
 *
 * Projects with no retention set are skipped entirely.
 */
async function purgeExpired() {
  const { rows: projects } = await pool.query(
    "select id, name, retention_days from projects where retention_days is not null",
  );

  if (projects.length === 0) {
    console.log("PURGE: no projects have a retention policy");
    return;
  }

  let total = 0;
  for (const p of projects) {
    const cutoff = new Date(Date.now() - p.retention_days * 86400000).toISOString();

    const snap = await pool.query(
      "delete from issue_snapshots where project_id = $1 and refreshed_at < $2",
      [p.id, cutoff],
    );
    const prs = await pool.query(
      `delete from pull_requests where project_id = $1
         and $1 in (select id from projects where prs_refreshed_at < $2)`,
      [p.id, cutoff],
    );
    const adrRows = await pool.query(
      `delete from adrs where project_id = $1
         and $1 in (select id from projects where adrs_refreshed_at < $2)`,
      [p.id, cutoff],
    );

    const n = (snap.rowCount ?? 0) + (prs.rowCount ?? 0) + (adrRows.rowCount ?? 0);
    total += n;
    if (n > 0) {
      console.log(`PURGE: ${p.name} (${p.retention_days}d) -> removed ${n} rows`);
    }
  }
  console.log(`PURGE: removed ${total} rows across ${projects.length} project(s)`);
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  tables,
  "seed-admin": () => seedAdmin(rest[0]),
  "rename-table": () => renameTable(rest[0], rest[1]),
  "ensure-app-role": () => ensureAppRole(rest[0], rest[1]),
  "verify-app-role": verifyAppRole,
  preflight,
  "verify-schema": verifySchema,
  "purge-expired": purgeExpired,
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
