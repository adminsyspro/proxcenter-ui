import { NextResponse } from "next/server"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

export async function DELETE() {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/deactivate`, {
      method: "DELETE",
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: data?.error || `HTTP ${res.status}` },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (e: any) {
    console.error("License deactivation failed:", e?.message)
    return NextResponse.json(
      { success: false, error: e?.message || "Failed to deactivate license" },
      { status: 500 }
    )
  }
}
