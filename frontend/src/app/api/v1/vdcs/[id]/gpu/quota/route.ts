// GET/PUT /api/v1/vdcs/{id}/gpu/quota
//   GET  the per-profile GPU contingent of a vDC, what each line holds, what
//        the vDC's cluster can offer and what its card models add up to
//   PUT  { entries } replaces the whole contingent
//
// Provider settings (#672), default tenant, gpu_management, admin.settings.vdcs
// (admin.settings.view to read). Open to API tokens (issue #1360): scope
// vdcs:read or vdcs:write, and a vDC on a connection outside the token's
// perimeter answers 404 like a missing one.
// A line lowered under what the vDC holds is kept and flagged overCommitted:
// nothing is detached, new attaches are refused until the usage falls.
import { NextResponse } from 'next/server'

import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { filterToTokenPerimeter } from '@/lib/api-tokens/scope'
import { withAudit } from '@/lib/audit/withAudit'
import type { Principal } from '@/lib/auth/principal'
import { gpuCode } from '@/lib/gpu/metrics'
import { requireGpuQuotaAccess } from '@/lib/gpu/quotaGuard'
import { loadVdcGpuContext, type VdcRef } from '@/lib/gpu/vdcContext'
import { listVdcGpuEntries, parseEntries, replaceVdcGpuEntries } from '@/lib/gpu/vdcEntries'
import { withVdcLock } from '@/lib/gpu/vdcLock'
import { quotaCapacity, quotaOffers, type GpuModelCapacity, type GpuOffer, type VdcGpuEntry } from '@/lib/gpu/vdcQuota'
import { PERMISSIONS } from '@/lib/rbac'
import { getVdcById } from '@/lib/vdc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }>; principal?: Principal }

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

/** The vDC, or null when it is missing or outside the token's perimeter. */
async function loadVdc(id: string, principal: Principal | undefined): Promise<VdcRef | null> {
  const found = await getVdcById(id)
  const [vdc] = found ? await filterToTokenPerimeter([found], principal, v => [v.connectionId]) : []
  if (!vdc) return null
  return { id: vdc.id, tenantId: vdc.tenantId, connectionId: vdc.connectionId, pvePoolName: vdc.pvePoolName, enabled: vdc.enabled }
}

async function handleGet(_req: Request, ctx: Ctx) {
  const denied = await requireGpuQuotaAccess(PERMISSIONS.ADMIN_SETTINGS_VIEW)
  if (denied) return denied
  const vdc = await loadVdc((await ctx.params).id, ctx.principal)
  if (!vdc) return gpuCode('not_found', 404)
  return NextResponse.json({ data: await quotaView(vdc, () => listVdcGpuEntries(vdc.id)) })
}

async function handlePut(req: Request, ctx: Ctx) {
  const denied = await requireGpuQuotaAccess(PERMISSIONS.ADMIN_SETTINGS_VDCS)
  if (denied) return denied
  const vdc = await loadVdc((await ctx.params).id, ctx.principal)
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

export const GET = withPublicApiGuard("vdc-gpu-quota-get", handleGet)
export const PUT = withAudit({ category: 'settings', resourceType: 'vdc', resourceParam: 'id' }, withPublicApiGuard("vdc-gpu-quota-update", handlePut))
