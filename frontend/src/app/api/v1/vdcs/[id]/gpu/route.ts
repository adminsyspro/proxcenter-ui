// GET /api/v1/vdcs/{id}/gpu
//   the GPUs of a vDC as its tenant sees them: the contingent lines with
//   their use, the VMs of the pool that hold a GPU, and their load
// POST /api/v1/vdcs/{id}/gpu
//   { action: 'attach', vmid, entryId } | { action: 'release', vmid, hostpci }
//   -> { data: { hostpci, pendingStart } }
//
// Tenant of the vDC (the provider may preview it, never write), gpu_management.
// GET reads the shared GPU snapshot of the vDC's connection: no PVE call of its
// own. POST picks the card itself and writes with the provider's token.
import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { gpuCode } from '@/lib/gpu/metrics'
import { parseVdcGpuAction, runVdcGpuAction } from '@/lib/gpu/vdcActions'
import { requireVdcGpuAccess } from '@/lib/gpu/vdcAccess'
import { loadVdcGpuContext, type VdcGpuContext, type VdcRef } from '@/lib/gpu/vdcContext'
import { buildMyGpuView } from '@/lib/gpu/vdcView'
import { filterVmsByPermission, getRBACContext, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** VMIDs of the pool the caller may view; null when it may view them all. */
async function visiblePoolVmids(ctx: VdcGpuContext, vdc: VdcRef): Promise<Set<string> | null> {
  const rbacCtx = await getRBACContext()
  if (!rbacCtx || rbacCtx.isAdmin) return null
  const principal = rbacCtx.principal ?? (rbacCtx.userId as string)
  const rows = new Map<string, { connId: string; node: string; type: string; vmid: string; tags: string[]; pool: string }>()
  for (const a of ctx.snapshot.allocations) {
    if (a.pool !== vdc.pvePoolName || rows.has(a.vmid)) continue
    rows.set(a.vmid, { connId: a.connId, node: a.node, type: 'qemu', vmid: a.vmid, tags: a.tags, pool: a.pool })
  }
  const ok = await filterVmsByPermission(principal, [...rows.values()], PERMISSIONS.VM_VIEW, rbacCtx.tenantId)
  return new Set(ok.map((v) => v.vmid))
}

export async function GET(_req: Request, ctx: Ctx) {
  const access = await requireVdcGpuAccess((await ctx.params).id, { write: false })
  if (!('vdc' in access)) return access.denied

  let gpu: VdcGpuContext
  try {
    gpu = await loadVdcGpuContext(access.vdc, { refresh: false })
  } catch (e: any) {
    console.warn('[vdc-gpu] view unreadable:', e?.message || String(e))
    return gpuCode('pve_refused', 502)
  }
  return NextResponse.json({ data: buildMyGpuView(gpu, await visiblePoolVmids(gpu, access.vdc)) })
}

async function handlePost(req: Request, ctx: Ctx) {
  const access = await requireVdcGpuAccess((await ctx.params).id, { write: true })
  if (!('vdc' in access)) return access.denied
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return gpuCode('invalid_body', 400)
  }
  const body = parseVdcGpuAction(raw)
  if (!body) return gpuCode('invalid_body', 400)
  return runVdcGpuAction(access.vdc, body)
}

export const POST = withAudit({ category: 'vms', resourceType: 'gpu' }, handlePost)
