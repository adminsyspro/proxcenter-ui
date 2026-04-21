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
    const response = await client.listMirrorSnapshots()

    const all = Array.isArray(response.data) ? response.data : []
    const filtered = all.filter((s: any) => !s.cluster_id || tenantConnectionIds.has(s.cluster_id))

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
    const items = Array.isArray(body?.items) ? body.items : []
    if (items.length === 0) {
      return NextResponse.json({ error: 'items is required' }, { status: 400 })
    }

    // Tenant-scope filter: drop items whose cluster is not owned by the current tenant
    const tenantConnectionIds = await getTenantConnectionIds()
    const scoped = items.filter((it: any) => it.cluster_id && tenantConnectionIds.has(it.cluster_id))
    if (scoped.length === 0) {
      return NextResponse.json({ deleted: [], failed: [] })
    }

    const client = getOrchestratorClient()
    const response = await client.deleteMirrorSnapshots(scoped)
    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error deleting mirror snapshots:", e)
    }
    return NextResponse.json(
      { error: e?.message || "Failed to delete snapshots" },
      { status: 500 }
    )
  }
}
