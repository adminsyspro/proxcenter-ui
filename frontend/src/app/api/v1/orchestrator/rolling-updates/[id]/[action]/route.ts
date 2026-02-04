import { NextResponse } from "next/server"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

// POST /api/v1/orchestrator/rolling-updates/[id]/[action]
// Actions: pause, resume, cancel, approve
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; action: string }> }
) {
  try {
    const { id, action } = await ctx.params

    // Validate action
    const validActions = ["pause", "resume", "cancel", "approve"]
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action: ${action}. Valid actions: ${validActions.join(", ")}` },
        { status: 400 }
      )
    }

    const response = await fetch(`${ORCHESTRATOR_URL}/api/v1/rolling-updates/${id}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || `Failed to ${action} rolling update` },
        { status: response.status }
      )
    }

    return NextResponse.json({ data })
  } catch (error: any) {
    console.error(`Error in rolling update action:`, error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
