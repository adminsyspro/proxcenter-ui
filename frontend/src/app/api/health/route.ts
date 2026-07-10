import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  let db = "reachable"
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    db = "unreachable"
  }

  return NextResponse.json({
    status: "ok",
    db,
    timestamp: new Date().toISOString(),
  })
}
