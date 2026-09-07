import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")
    if (denied) return denied

    const q = request.nextUrl.searchParams
    const cluster = q.get('cluster') || ''
    const pool = q.get('pool') || ''
    const image = q.get('image') || ''
    const snap = q.get('snap') || ''
    const engine = q.get('storage_engine') || 'rbd'
    const node = q.get('node') || ''
    if ((engine !== 'rbd' && engine !== 'zfs') || (engine === 'zfs' && !node)) {
      return NextResponse.json({ error: 'Valid storage_engine and ZFS node are required' }, { status: 400 })
    }
    if (!cluster || !pool || !image || !snap) {
      return NextResponse.json({ error: 'cluster, pool, image, snap are required' }, { status: 400 })
    }

    const tenantConnectionIds = await getTenantConnectionIds()
    if (!tenantConnectionIds.has(cluster)) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
    }

    const client = getOrchestratorClient()
    const response = await client.getSnapshotUsage(cluster, pool, image, snap, engine, node)
    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error getting snapshot usage:", e)
    }
    return NextResponse.json(
      { error: e?.message || "Failed to get snapshot usage" },
      { status: 500 }
    )
  }
}
