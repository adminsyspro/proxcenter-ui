import { NextResponse } from 'next/server'

import { HISTORY_RANGES, hostHistory, startHostHistorySampler } from '@/lib/platform/history'
import { readHost } from '@/lib/platform/sysinfo'
import type { HostHistoryRange } from '@/lib/platform/types'
import { Features } from '@/lib/license/features'
import { requireFeature } from '@/lib/auth/requireEnterprise'
import { PERMISSIONS } from '@/lib/rbac'
import { requireProviderAdmin } from '@/lib/tenant/providerGuard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const isRange = (value: string | null): value is HostHistoryRange => value !== null && Object.hasOwn(HISTORY_RANGES, value)

/**
 * GET /api/v1/system/status/history?range=1h|6h|24h
 * Host load and memory of this instance over the range, for the charts of
 * the Platform status tab. Provider administrators only, like the status.
 */
export async function GET(req: Request) {
  const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied

  const unlicensed = await requireFeature(Features.PLATFORM_STATUS)
  if (unlicensed) return unlicensed

  const range = new URL(req.url).searchParams.get('range') ?? '1h'

  if (!isRange(range)) return NextResponse.json({ error: 'range must be 1h, 6h or 24h' }, { status: 400 })

  // Started at boot; this covers a process that booted without it.
  startHostHistorySampler()

  return NextResponse.json(hostHistory(range, Date.now(), await readHost()))
}
