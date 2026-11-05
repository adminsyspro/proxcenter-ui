// GET /api/v1/vdcs/{id}/gpu/hours?month=YYYY-MM
//   the GPU hours of a vDC for a month (the current one by default), per VM and
//   per profile, read from the hourly usage rows: hours only, never an amount
//
// Tenant of the vDC (the provider may preview it), gpu_management. No PVE call:
// the profile names come from the orchestrator's shared GPU readings.
import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'
import { currentMonth } from '@/lib/gpu/billing/load'
import { monthRange } from '@/lib/gpu/billing/report'
import { getGpuMetricsLatest, gpuCode } from '@/lib/gpu/metrics'
import type { VisibleVgpuType } from '@/lib/gpu/metricsShared'
import { requireVdcGpuAccess } from '@/lib/gpu/vdcAccess'
import { buildMyGpuHours } from '@/lib/gpu/vdcHours'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** The profiles of the vDC's connection; empty when the orchestrator cannot be read. */
async function readCatalog(connectionId: string): Promise<VisibleVgpuType[]> {
  try {
    const snap = await getGpuMetricsLatest()
    return (snap.vgpu_types ?? [])
      .filter((t) => t.connection_id === connectionId)
      .map((t) => ({ deviceKey: `${t.connection_id}:${t.node}:${t.bus_id}`, typeId: t.type_id, name: t.name, fbMemory: t.fb_memory, maxInstances: t.max_instances }))
  } catch (e: any) {
    console.warn('[vdc-gpu] profile names unavailable:', e?.message || String(e))
    return []
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const access = await requireVdcGpuAccess((await ctx.params).id, { write: false })
  if (!('vdc' in access)) return access.denied

  const month = new URL(req.url).searchParams.get('month') ?? currentMonth()
  const range = monthRange(month)
  if (!range) return gpuCode('invalid_body', 400)

  try {
    const [rows, catalog] = await Promise.all([
      prisma.gpuUsageHour.findMany({
        where: { vdcId: access.vdc.id, hour: { gte: range.from, lt: range.to } },
        orderBy: { hour: 'asc' },
        select: { vmid: true, vmName: true, deviceKey: true, modelName: true, mdev: true, runningSeconds: true, reservedSeconds: true },
      }),
      readCatalog(access.vdc.connectionId),
    ])
    return NextResponse.json({ data: buildMyGpuHours(month, rows, catalog) })
  } catch (e: any) {
    console.warn('[vdc-gpu] hours unreadable:', e?.message || String(e))
    return gpuCode('unavailable', 503)
  }
}
