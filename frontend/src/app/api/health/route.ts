import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    // Verify database connectivity
    await prisma.$queryRaw`SELECT 1`

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Health check failed:", error)

    return NextResponse.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    )
  }
}
