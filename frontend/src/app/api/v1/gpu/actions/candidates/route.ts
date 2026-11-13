// GET /api/v1/gpu/actions/candidates?deviceKey=<connId:node:slot>
//
// The VMs a GPU can be attached to (#672, lot C): the QEMU guests of its node,
// templates left out, narrowed to those the caller may view. One
// /cluster/resources read, no per-guest call.
import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'
import { getConnectionById } from '@/lib/connections/getConnection'
import { requireGpuActions } from '@/lib/gpu/guard'
import { gpuCode } from '@/lib/gpu/metrics'
import { pveFetch } from '@/lib/proxmox/client'
import { PERMISSIONS, filterVmsByPermission, getRBACContext } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const access = await requireGpuActions()
  if (access.denied) return access.denied
  const deviceKey = new URL(req.url).searchParams.get('deviceKey') ?? ''
  const m = /^([^:]+):([A-Za-z0-9.-]{1,63}):[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}$/i.exec(deviceKey)
  if (!m) return gpuCode('invalid_device', 400)
  const [, connId, node] = m
  const row = await prisma.connection.findFirst({ where: { id: connId, type: 'pve' }, select: { id: true, tenantId: true } })
  if (!row) return gpuCode('invalid_device', 400)
  try {
    const conn = await getConnectionById(row.id, row.tenantId)
    const resources = (await pveFetch<any[]>(conn, '/cluster/resources?type=vm')) || []
    let vms = resources
      .filter(r => r?.type === 'qemu' && String(r.node) === node && !(r.template === 1 || r.template === true))
      .map(r => ({ connId, node, vmid: String(r.vmid), name: r.name ? String(r.name) : `VM ${r.vmid}`, status: String(r.status ?? 'unknown'), pool: r.pool ? String(r.pool) : null, tags: r.tags ? String(r.tags).split(/[;,\s]+/).filter(Boolean) : [] }))
    const rbac = await getRBACContext()
    if (rbac && !rbac.isAdmin) {
      const principal = rbac.principal ?? (rbac.userId as string)
      const ok = await filterVmsByPermission(principal, vms.map(v => ({ ...v, type: 'qemu' })), PERMISSIONS.VM_CONFIG_HARDWARE, rbac.tenantId)
      const keep = new Set(ok.map(v => v.vmid))
      vms = vms.filter(v => keep.has(v.vmid))
    }
    vms.sort((a, b) => Number(a.status !== 'stopped') - Number(b.status !== 'stopped') || a.name.localeCompare(b.name))
    return NextResponse.json({ data: vms.map(({ tags: _t, ...v }) => v) })
  } catch (e: any) {
    console.error('[gpu-actions] candidates:', e?.message)
    return gpuCode('pve_unreachable', 502)
  }
}
