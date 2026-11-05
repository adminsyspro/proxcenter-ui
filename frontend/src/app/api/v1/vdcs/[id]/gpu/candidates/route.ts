// GET /api/v1/vdcs/{id}/gpu/candidates
//   the VMs of a vDC a GPU may be given to: qemu VMs of its pool, templates
//   left out, that the caller may change the hardware of
//
// Tenant of the vDC (the provider may preview it), gpu_management. Read when
// the attach dialog opens: one /pools/{pool} call with the provider's token.
import { NextResponse } from 'next/server'

import { gpuCode } from '@/lib/gpu/metrics'
import { requireVdcGpuAccess } from '@/lib/gpu/vdcAccess'
import { loadVdcConnection, readPoolQemu, type PoolVm } from '@/lib/gpu/vdcContext'
import { filterVmsByPermission, getRBACContext, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const access = await requireVdcGpuAccess((await ctx.params).id, { write: false })
  if (!('vdc' in access)) return access.denied
  const { vdc } = access

  let vms: PoolVm[]
  try {
    const { conn } = await loadVdcConnection(vdc)
    vms = await readPoolQemu(conn, vdc.pvePoolName)
  } catch (e: any) {
    console.warn('[vdc-gpu] pool unreadable:', e?.message || String(e))
    return gpuCode('pve_refused', 502)
  }

  let rows = vms.map((v) => ({ connId: vdc.connectionId, type: 'qemu', ...v, pool: vdc.pvePoolName }))
  const rbacCtx = await getRBACContext()
  if (rbacCtx && !rbacCtx.isAdmin) {
    const principal = rbacCtx.principal ?? (rbacCtx.userId as string)
    rows = await filterVmsByPermission(principal, rows, PERMISSIONS.VM_CONFIG_HARDWARE, rbacCtx.tenantId)
  }

  const data = rows
    .map((r) => ({ vmid: r.vmid, name: r.name, status: r.status }))
    .sort((a, b) => Number(a.vmid) - Number(b.vmid))
  return NextResponse.json({ data })
}
