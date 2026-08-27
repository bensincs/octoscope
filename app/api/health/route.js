import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/health — probe target for the Azure Container Apps readiness probe.
//
// Deliberately unauthenticated: it has to answer before anyone can sign in, and
// it reveals nothing beyond whether the app can reach Postgres. The underlying
// error is logged, never returned, so a failure can't leak the connection
// string or server internals.
//
// Used as the *readiness* probe only. Liveness intentionally points elsewhere —
// restarting the container will not fix an unreachable database, and doing so
// during a brief Postgres blip would turn a recoverable outage into a crash
// loop.
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch (e) {
    console.error("[health] database unreachable:", e);
    return Response.json({ status: "degraded" }, { status: 503 });
  }
}
