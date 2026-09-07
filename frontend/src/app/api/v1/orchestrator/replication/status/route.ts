import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")
    if (denied) return denied

    const tenantConnectionIds = await getTenantConnectionIds()
    const client = getOrchestratorClient()
    const response = await client.getReplicationHealth()

    // Filter sites by tenant connections
    const data = response.data
    if (data?.sites && Array.isArray(data.sites)) {
      data.sites = data.sites.filter(s => !s.cluster_id || tenantConnectionIds.has(s.cluster_id))
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Failed to load replication status" }, { status: 502 })
  }
}
