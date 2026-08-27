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
 *
 * Requires DATABASE_URL. `seed-admin` also accepts SEED_LOGIN as a fallback.
 */
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  tables,
  "seed-admin": () => seedAdmin(rest[0]),
  "rename-table": () => renameTable(rest[0], rest[1]),
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
