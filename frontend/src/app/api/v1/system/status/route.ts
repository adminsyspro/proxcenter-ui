import { NextResponse } from 'next/server'

import { buildPlatformStatus } from '@/lib/platform/status'
import { Features } from '@/lib/license/features'
import { requireFeature } from '@/lib/auth/requireEnterprise'
import { PERMISSIONS } from '@/lib/rbac'
import { requireProviderAdmin } from '@/lib/tenant/providerGuard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/system/status
 * State of the ProxCenter installation itself: services, host load, disks,
 * database and scheduled tasks. An Enterprise capability (platform_status),
 * platform-wide, so provider administrators only. Always 200 when the caller may read it: a part that is down is
 * reported in the payload, not as a failed request.
 */
export async function GET() {
  const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied

  const unlicensed = await requireFeature(Features.PLATFORM_STATUS)
  if (unlicensed) return unlicensed

  return NextResponse.json(await buildPlatformStatus())
}
