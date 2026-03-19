import { NextRequest, NextResponse } from "next/server"

import { orchestratorFetch } from "@/lib/orchestrator"

export const runtime = "nodejs"

// GET /api/v1/orchestrator/sflow?endpoint=status|top-talkers|top-pairs|top-ports|agents
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const endpoint = searchParams.get("endpoint") || "status"

    const allowed = ["status", "top-talkers", "top-pairs", "top-ports", "agents"]
    if (!allowed.includes(endpoint)) {
      return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 })
    }

    // Forward query params (n, window, etc.)
    const params = new URLSearchParams()
    for (const [key, value] of searchParams.entries()) {
      if (key !== "endpoint") {
        params.set(key, value)
      }
    }

    const queryString = params.toString() ? `?${params.toString()}` : ""
    const data = await orchestratorFetch(`/sflow/${endpoint}${queryString}`)

    return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== "ORCHESTRATOR_UNAVAILABLE") {
      console.error("Failed to fetch sFlow data:", String(error?.message || "").replace(/[\r\n]/g, ""))
    }

    return NextResponse.json(
      { error: error.message || "Failed to fetch sFlow data" },
      { status: 500 }
    )
  }
}
