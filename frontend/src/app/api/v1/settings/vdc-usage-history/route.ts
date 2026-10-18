// Provider settings of the vDC usage history (#902): sampling on/off, cadence
// and retention, plus what the sampler last did so the settings tab can show
// that it runs.

import { NextResponse } from 'next/server'

import { audit } from '@/lib/audit'
import { prisma } from '@/lib/db/prisma'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderTenant } from '@/lib/tenant'
import { VDC_USAGE_SAMPLER_LEASE } from '@/lib/vdc/usageHistory/sampler'
import {
  loadVdcUsageHistorySettings,
  saveVdcUsageHistorySettings,
  vdcUsageHistorySettingsSchema,
  type VdcUsageHistorySettings,
} from '@/lib/vdc/usageHistory/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function guard(): Promise<Response | null> {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate

  return checkPermission(PERMISSIONS.ADMIN_SETTINGS)
}

async function payload(settings: VdcUsageHistorySettings) {
  const [samples, last, lease] = await Promise.all([
    prisma.vdcUsageSample.count(),
    prisma.vdcUsageSample.findFirst({ orderBy: { sampledAt: 'desc' }, select: { sampledAt: true } }),
    prisma.schedulerLease.findUnique({ where: { name: VDC_USAGE_SAMPLER_LEASE } }),
  ])

  return {
    data: settings,
    status: {
      samples,
      lastSampledAt: last?.sampledAt.toISOString() ?? null,
      // A lease past its expiry means no process sampled for several minutes.
      samplerActive: !!lease && lease.expiresAt.getTime() > Date.now(),
    },
  }
}

export async function GET() {
  const denied = await guard()
  if (denied) return denied

  try {
    return NextResponse.json(await payload(await loadVdcUsageHistorySettings()))
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const denied = await guard()
  if (denied) return denied

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = vdcUsageHistorySettingsSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid settings',
        issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
      },
      { status: 400 },
    )
  }

  try {
    const before = await loadVdcUsageHistorySettings()
    const saved = await saveVdcUsageHistorySettings(parsed.data)

    await audit({
      action: 'update',
      category: 'settings',
      resourceType: 'vdc_usage_history_settings',
      resourceId: 'vdc_usage_history_settings',
      resourceName: 'vDC usage history settings',
      details: { before, after: saved },
    })

    return NextResponse.json(await payload(saved))
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}
