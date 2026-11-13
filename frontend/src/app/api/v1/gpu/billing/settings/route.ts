// GET /api/v1/gpu/billing/settings   the chargeback settings and the GPU
//                                    models to price (inventory and history)
// PUT /api/v1/gpu/billing/settings   the chargeback settings
//
// Provider tenant, gpu_management, admin.settings (lib/gpu/guard).
import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { prisma } from '@/lib/db/prisma'
import { gpuBillingSettingsSchema, loadGpuBillingSettings, saveGpuBillingSettings } from '@/lib/gpu/billing/settings'
import { modelKey } from '@/lib/gpu/fleet'
import { requireGpuSettings } from '@/lib/gpu/guard'
import { gpuCode } from '@/lib/gpu/metrics'
import { loadVisibleGpuReport } from '@/lib/gpu/visibleReport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await requireGpuSettings()
  if (access.denied) return access.denied
  const [settings, report, seen] = await Promise.all([
    loadGpuBillingSettings(),
    loadVisibleGpuReport().catch(() => null),
    prisma.gpuUsageHour.findMany({ distinct: ['modelKey'], select: { modelKey: true, modelName: true } }),
  ])
  const models = new Map<string, string>()
  for (const d of report?.devices ?? []) if (d.kind === 'gpu') models.set(modelKey(d), d.deviceName || d.vendorName || '?')
  for (const s of seen) if (!models.has(s.modelKey)) models.set(s.modelKey, s.modelName)
  return NextResponse.json({
    data: { settings, models: [...models.entries()].map(([key, name]) => ({ modelKey: key, modelName: name })).sort((a, b) => a.modelName.localeCompare(b.modelName)) },
  })
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
  const parsed = gpuBillingSettingsSchema.safeParse(raw)
  if (!parsed.success) return gpuCode('invalid_body', 400)
  return NextResponse.json({ data: await saveGpuBillingSettings(parsed.data) })
}

export const PUT = withAudit({ category: 'settings', resourceType: 'gpu_billing_settings' }, handlePut)
