import { NextResponse } from "next/server"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    if (!body?.license) {
      return NextResponse.json(
        { success: false, error: "License key is required" },
        { status: 400 }
      )
    }

    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ license: body.license }),
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
    console.error("License activation failed:", e?.message)
    return NextResponse.json(
      { success: false, error: e?.message || "Failed to activate license" },
      { status: 500 }
    )
  }
}
