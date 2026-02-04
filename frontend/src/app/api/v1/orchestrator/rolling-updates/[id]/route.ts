import { NextResponse } from "next/server"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

// GET /api/v1/orchestrator/rolling-updates/[id] - Get a specific rolling update
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params

    const response = await fetch(`${ORCHESTRATOR_URL}/api/v1/rolling-updates/${id}`, {
      headers: {
        "Content-Type": "application/json",
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Rolling update not found" },
        { status: response.status }
      )
    }

    return NextResponse.json({ data })
  } catch (error: any) {
    console.error("Error getting rolling update:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
