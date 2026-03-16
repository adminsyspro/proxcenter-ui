import { NextRequest, NextResponse } from "next/server"

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
    const response = await client.getReplicationJobs()

    const all = Array.isArray(response.data) ? response.data : []
    const filtered = all.filter((j: any) =>
      (!j.source_cluster || tenantConnectionIds.has(j.source_cluster)) &&
      (!j.target_cluster || tenantConnectionIds.has(j.target_cluster))
    )

    return NextResponse.json(filtered)
  } catch {
    return NextResponse.json([])
  }
}

export async function POST(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const body = await request.json()

    // Validate cluster connections belong to current tenant
    const tenantConnectionIds = await getTenantConnectionIds()
    if (body.source_cluster && !tenantConnectionIds.has(body.source_cluster)) {
      return NextResponse.json({ error: 'Source cluster not found' }, { status: 404 })
    }
    if (body.target_cluster && !tenantConnectionIds.has(body.target_cluster)) {
      return NextResponse.json({ error: 'Target cluster not found' }, { status: 404 })
    }

    const client = getOrchestratorClient()
    const response = await client.createReplicationJob(body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error creating replication job:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to create replication job" },
      { status: 500 }
    )
  }
}
