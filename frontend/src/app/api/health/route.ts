import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"

import { liveResponse } from "./liveness"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Readiness endpoint (pre-HA contract restored): 503 when the DB is
// unreachable so HTTP-status monitoring detects a stopped Postgres.
// ?live=1 short-circuits to the liveness response for probes that cannot
// use the dedicated /api/health/live path.
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("live") === "1") {
    return liveResponse()
  }

  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    return NextResponse.json(
      {
        status: "unhealthy",
        db: "unreachable",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    )
  }

  return NextResponse.json({
    status: "healthy",
    db: "reachable",
    timestamp: new Date().toISOString(),
  })
}
