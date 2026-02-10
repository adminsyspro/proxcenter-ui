import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const body = await request.json()
    const client = getOrchestratorClient()
    const response = await client.checkSSHConnectivity(body.source_cluster, body.target_cluster)

    return NextResponse.json(response.data)
  } catch (e: any) {
    return NextResponse.json(
      { connected: false, source_node: "", target_node: "", target_ip: "", error: e?.message || "Failed to check SSH connectivity" },
      { status: 200 }
    )
  }
}
