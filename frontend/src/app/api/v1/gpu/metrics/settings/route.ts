// GET /api/v1/gpu/metrics/settings   the collector settings, plus the VMs and
//                                    nodes that hold GPUs (what can be opted in)
// PUT /api/v1/gpu/metrics/settings   the collector settings
//
// Provider tenant only and admin.settings (lib/gpu/guard): opting a VM in runs
// nvidia-smi inside it through its guest agent at every interval. Every
// target must be a Proxmox VE connection of the install.
import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { prisma } from '@/lib/db/prisma'
import { workloads } from '@/lib/gpu/fleet'
import { requireGpuSettings } from '@/lib/gpu/guard'
import {
  getGpuMetricsSettings,
  gpuCode,
  gpuMetricsErrorResponse,
  putGpuMetricsSettings,
  type GpuMetricsSettings,
} from '@/lib/gpu/metrics'
import { loadVisibleGpuReport } from '@/lib/gpu/visibleReport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await requireGpuSettings()
  if (access.denied) return access.denied
  try {
    const [settings, report] = await Promise.all([getGpuMetricsSettings(), loadVisibleGpuReport()])
    const guests = workloads(report)
      .filter(w => !w.template)
      .map(w => ({
        connectionId: w.connId,
        connectionName: w.connectionName,
        node: w.node,
        vmid: Number(w.vmid),
        vmName: w.vmName,
        vmStatus: w.vmStatus,
        gpus: w.gpus.map(g => g.deviceName || g.vendorName || '?'),
      }))
    const nodes = [...new Map(report.devices.filter(d => d.kind === 'gpu').map(d => [`${d.connId}|${d.node}`, { connectionId: d.connId, connectionName: d.connectionName, node: d.node }])).values()]
    return NextResponse.json({ data: { settings, candidates: { guests, nodes } } })
  } catch (e) {
    return gpuMetricsErrorResponse(e, 'get settings')
  }
}

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)

/** Shape check only; the orchestrator validates the ranges and answers a code. */
function parseBody(body: any): GpuMetricsSettings | null {
  if (!body || typeof body !== 'object' || typeof body.enabled !== 'boolean') return null
  if (!Array.isArray(body.guest_vms) || !Array.isArray(body.host_nodes) || !body.thresholds) return null
  const guest_vms = body.guest_vms.map((g: any) => ({ connection_id: String(g?.connection_id ?? ''), vmid: int(g?.vmid) }))
  const host_nodes = body.host_nodes.map((n: any) => ({ connection_id: String(n?.connection_id ?? ''), node: String(n?.node ?? '') }))
  if (guest_vms.some((g: any) => !g.connection_id || !(g.vmid > 0))) return null
  if (host_nodes.some((n: any) => !n.connection_id || !/^[A-Za-z0-9.-]{1,63}$/.test(n.node))) return null
  return {
    enabled: body.enabled,
    interval_seconds: int(body.interval_seconds),
    retention_days: int(body.retention_days),
    guest_vms,
    host_nodes,
    thresholds: { util_pct: num(body.thresholds.util_pct), memory_pct: num(body.thresholds.memory_pct), temp_c: num(body.thresholds.temp_c) },
    alerts: body.alerts !== false,
    idle_days: Number.isInteger(body.idle_days) ? body.idle_days : 7,
  }
}

async function handlePut(req: Request) {
  const access = await requireGpuSettings()
  if (access.denied) return access.denied
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return gpuCode('invalid_body', 400)
  }
  const next = parseBody(raw)
  if (!next) return gpuCode('invalid_body', 400)
  const ids = [...new Set([...next.guest_vms.map(g => g.connection_id), ...next.host_nodes.map(n => n.connection_id)])]
  if (ids.length) {
    const known = await prisma.connection.count({ where: { id: { in: ids }, type: 'pve' } })
    if (known !== ids.length) return gpuCode('invalid_target', 400)
  }
  try {
    return NextResponse.json({ data: await putGpuMetricsSettings(next) })
  } catch (e) {
    return gpuMetricsErrorResponse(e, 'put settings')
  }
}

export const PUT = withAudit({ category: 'settings', resourceType: 'gpu_metrics_settings' }, handlePut)
