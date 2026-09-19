import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient, parseOrchestratorError } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; vmid: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, 'global', '*')
    if (denied) return denied

    const { id, vmid } = await params
    const vmId = Number(vmid)
    if (!/^\d+$/.test(vmid) || !Number.isSafeInteger(vmId) || vmId <= 0) {
      return NextResponse.json({ error: 'vmid must be a positive integer' }, { status: 400 })
    }
    const body = await request.json().catch(() => null)
    if (body?.confirm !== true) {
      return NextResponse.json({ error: 'Explicit re-seed confirmation is required' }, { status: 400 })
    }

    const client = getOrchestratorClient()
    const tenantConnectionIds = await getTenantConnectionIds()
    const { data: job } = await client.getReplicationJob(id)
    if (!job || !tenantConnectionIds.has(job.source_cluster) || !tenantConnectionIds.has(job.target_cluster)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const response = await client.reseedReplicationJobVM(id, vmId)
    return NextResponse.json(response.data, { status: 202 })
  } catch (error) {
    const upstream = parseOrchestratorError(error)
    return NextResponse.json(
      { error: upstream?.message || 'Failed to queue full replication' },
      { status: upstream?.status || 500 },
    )
  }
}
