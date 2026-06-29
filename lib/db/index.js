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
