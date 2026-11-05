// POST /api/v1/gpu/metrics/probe  { connectionId, vmid } | { connectionId, node }
//
// Reads one VM or node now without storing anything: the Test button of the
// settings, before opting it in. Provider administrators only.
import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { requireGpuSettings } from '@/lib/gpu/guard'
import { gpuCode, gpuMetricsErrorResponse, probeGpuMetrics } from '@/lib/gpu/metrics'
import { prisma } from '@/lib/db/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost(req: Request) {
  const access = await requireGpuSettings()
  if (access.denied) return access.denied
  let body: any
  try {
    body = await req.json()
  } catch {
    return gpuCode('invalid_body', 400)
  }
  const connectionId = typeof body?.connectionId === 'string' ? body.connectionId : ''
  const vmid = Number.isInteger(body?.vmid) && body.vmid > 0 ? body.vmid : undefined
  const node = typeof body?.node === 'string' && /^[A-Za-z0-9.-]{1,63}$/.test(body.node) ? body.node : undefined
  if (!connectionId || (!vmid && !node)) return gpuCode('invalid_target', 400)
  const conn = await prisma.connection.findFirst({ where: { id: connectionId, type: 'pve' }, select: { id: true } })
  if (!conn) return gpuCode('invalid_target', 400)
  try {
    return NextResponse.json({ data: await probeGpuMetrics({ connection_id: connectionId, ...(vmid ? { vmid } : { node }) }) })
  } catch (e) {
    return gpuMetricsErrorResponse(e, 'probe')
  }
}

export const POST = withAudit({ category: 'settings', resourceType: 'gpu_metrics_probe' }, handlePost)
