import { NextRequest, NextResponse } from "next/server"

import { denyExecutionOutsideTenant } from "@/lib/orchestrator/executionScope"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; vmid: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { id, vmid } = await params

    if (!/^\d+$/.test(vmid)) {
      return NextResponse.json({ error: "Invalid vmid" }, { status: 400 })
    }

    const scopeDenied = await denyExecutionOutsideTenant(id)

    if (scopeDenied) return scopeDenied

    // The orchestrator client is JSON-only; fetch the PNG directly and pass
    // the bytes through untouched.
    const headers: Record<string, string> = {}

    if (process.env.ORCHESTRATOR_API_KEY) headers["X-API-Key"] = process.env.ORCHESTRATOR_API_KEY

    const upstream = await fetch(
      `${process.env.ORCHESTRATOR_URL || "http://localhost:8080"}/api/v1/replication/executions/${encodeURIComponent(id)}/screenshots/${vmid}`,
      { headers }
    )

    if (!upstream.ok) {
      return NextResponse.json({ error: "Screenshot not found" }, { status: 404 })
    }

    const png = await upstream.arrayBuffer()

    return new NextResponse(png, {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" },
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to fetch screenshot" },
      { status: 500 }
    )
  }
}
