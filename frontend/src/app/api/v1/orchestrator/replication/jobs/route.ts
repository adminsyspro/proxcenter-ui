import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"
import { withAudit } from "@/lib/audit/withAudit"
import { getReplicationScope, scopeReplicationItems } from "@/lib/orchestrator/replicationScope"

export const runtime = "nodejs"

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")
    if (denied) return denied

    const scope = await getReplicationScope()
    const client = getOrchestratorClient()
    const response = await client.getReplicationJobs()

    // A job whose connection was deleted is listed to the provider, flagged,
    // so it can be deleted (ui#1394); a tenant sees its own jobs only.
    return NextResponse.json(scopeReplicationItems(response.data, scope))
  } catch {
    return NextResponse.json([])
  }
}

async function handlePost(request: NextRequest) {
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

export const POST = withAudit({ category: "replication", resourceType: "job" }, handlePost)
