import { NextResponse } from "next/server"

// Shared by /api/health?live=1 and /api/health/live. Liveness only says
// "the Node process serves HTTP"; it must never depend on the DB, so HA
// container healthchecks do not flap during failover. Readiness (DB
// reachability, 503 otherwise) lives in ./route.ts and is what keepalived's
// track_script and external monitoring consume.
export function liveResponse(): NextResponse {
  return NextResponse.json({
    status: "alive",
    timestamp: new Date().toISOString(),
  })
}
