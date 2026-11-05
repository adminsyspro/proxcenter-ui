// GET/PUT /api/v1/vdcs/{id}/gpu/quota
//   GET  the per-profile GPU contingent of a vDC, what each line holds, what
//        the vDC's cluster can offer and what its card models add up to
//   PUT  { entries } replaces the whole contingent
//
// Provider settings (#672), default tenant, gpu_management, admin.settings.
// A line lowered under what the vDC holds is kept and flagged overCommitted:
// nothing is detached, new attaches are refused until the usage falls.
import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { requireGpuSettings } from '@/lib/gpu/guard'
import { gpuCode } from '@/lib/gpu/metrics'
import { loadVdcGpuContext, type VdcRef } from '@/lib/gpu/vdcContext'
import { listVdcGpuEntries, parseEntries, replaceVdcGpuEntries } from '@/lib/gpu/vdcEntries'
import { withVdcLock } from '@/lib/gpu/vdcLock'
import { quotaCapacity, quotaOffers, type GpuModelCapacity, type GpuOffer, type VdcGpuEntry } from '@/lib/gpu/vdcQuota'
import { getVdcById } from '@/lib/vdc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

type QuotaView = {
  entries: Array<VdcGpuEntry & { held: number; overCommitted: boolean }>
  offers: GpuOffer[]
  /** What each card model of the cluster adds up to, to judge the contingent against. */
  capacity: GpuModelCapacity[]
  /** False when the cluster could not be read: offers, capacity and held are then unknown. */
  readable: boolean
}

const withHeld = (entries: VdcGpuEntry[], usage: Map<string, number>) =>
  entries.map((e) => {
    const held = usage.get(e.id) ?? 0
    return { ...e, held, overCommitted: held > e.count }
  })

/** The contingent as stored, with the cluster side when it can be read. Never throws. */
async function quotaView(vdc: VdcRef, stored: () => Promise<VdcGpuEntry[]>): Promise<QuotaView> {
  try {
    const ctx = await loadVdcGpuContext(vdc, { refresh: false })
    return {
      entries: withHeld(ctx.entries, ctx.usage),
      offers: quotaOffers(ctx.report, ctx.catalog, vdc.connectionId),
      capacity: quotaCapacity(ctx.report, ctx.catalog, vdc.connectionId),
      readable: true,
    }
  } catch (e: any) {
    console.warn('[vdc-gpu] quota context unreadable:', e?.message || String(e))
    return { entries: withHeld(await stored(), new Map()), offers: [], capacity: [], readable: false }
  }
}

async function loadVdc(id: string): Promise<VdcRef | null> {
  const vdc = await getVdcById(id)
  if (!vdc) return null
  return { id: vdc.id, tenantId: vdc.tenantId, connectionId: vdc.connectionId, pvePoolName: vdc.pvePoolName, enabled: vdc.enabled }
}

export async function GET(_req: Request, ctx: Ctx) {
  const access = await requireGpuSettings()
  if (access.denied) return access.denied
  const vdc = await loadVdc((await ctx.params).id)
  if (!vdc) return gpuCode('not_found', 404)
  return NextResponse.json({ data: await quotaView(vdc, () => listVdcGpuEntries(vdc.id)) })
}

async function handlePut(req: Request, ctx: Ctx) {
  const access = await requireGpuSettings()
  if (access.denied) return access.denied
  const vdc = await loadVdc((await ctx.params).id)
  if (!vdc) return gpuCode('not_found', 404)

  const raw = await req.json().catch(() => null)
  const parsed = parseEntries((raw as { entries?: unknown } | null)?.entries)
  if (!parsed.ok) return gpuCode('invalid_body', 400)

  const view = await withVdcLock(vdc.id, async () => {
    const saved = await replaceVdcGpuEntries(vdc.id, parsed.entries)
    return quotaView(vdc, async () => saved)
  })
  return NextResponse.json({ data: view })
}

export const PUT = withAudit({ category: 'settings', resourceType: 'vdc', resourceParam: 'id' }, handlePut)
