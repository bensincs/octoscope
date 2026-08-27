import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://hygiene:hygiene@localhost:5432/hygiene";

// Reuse the pool across hot-reloads in dev to avoid exhausting connections.
const globalForDb = globalThis;

const pool =
  globalForDb.__pgPool ||
  new Pool({
    connectionString,
    max: 10,
    // Fail fast when Postgres is unreachable.
    //
    // node-postgres defaults this to 0, meaning "wait forever". With a stopped
    // database that turns every request into an indefinite hang instead of a
    // quick error — including /api/health, so the readiness probe times out
    // rather than reporting unhealthy, and the ingress is left with no ready
    // replica to route to. The site stops responding entirely rather than
    // returning a clean 503.
    //
    // This subscription's governance stops idle databases, so an unreachable
    // Postgres is an expected state, not an exceptional one.
    connectionTimeoutMillis: 5_000,
    // Don't let one slow statement pin a pooled connection indefinitely.
    // statement_timeout is enforced by the server, query_timeout by the client.
    statement_timeout: 20_000,
    query_timeout: 20_000,
    idleTimeoutMillis: 30_000,
    // Enable TLS when the URL asks for it (managed Postgres in prod).
    ssl: /sslmode=require/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
  });

if (!globalForDb.__pgPool) {
  globalForDb.__pgPool = pool;

  // An idle client emitting 'error' (e.g. DB restart) would otherwise crash
  // the Node process. Log and let the pool recycle the connection.
  pool.on("error", (err) => {
    console.error("[db] unexpected idle client error:", err);
  });

  // Drain connections cleanly on shutdown.
  const close = () => {
    pool.end().catch(() => {});
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

export const db = drizzle(pool, { schema });
export { pool };
