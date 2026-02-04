import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

export async function GET() {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/features`, {
      cache: "no-store",
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error || `HTTP ${res.status}` },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (e: any) {
    console.error("License features fetch failed:", e?.message)
    return NextResponse.json(
      { error: e?.message || "Failed to fetch license features" },
      { status: 500 }
    )
  }
}
