export const dynamic = "force-dynamic";

// GET /api/health/live — shallow liveness/readiness probe.
//
// Deliberately checks NOTHING but that this process can serve a request. It is
// the target for both the readiness and liveness probes.
//
// Readiness must not depend on Postgres. This subscription's governance stops
// idle databases, and gating readiness on the database meant a stopped database
// pulled the only replica out of rotation — so the ingress had no backend and
// requests hung with no response at all, instead of the app loading and showing
// an error. A dependency outage became a total outage.
//
// The deep check still exists at /api/health for humans and monitoring; it just
// isn't allowed to decide whether the app receives traffic.
export async function GET() {
  return Response.json({ status: "ok" });
}
