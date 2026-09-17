// src/lib/syslog/guard.ts
//
// Write guard for the syslog destination routes. Same shape and same
// reasoning as src/lib/broadcast/guard.ts (raw tenant claim, not
// getCurrentTenantId(), so a tenant admin can never be promoted into the
// provider tenant by the "default" fallback), plus the licence gate of the
// Notifications tab the card lives in.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { requireFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { PERMISSIONS, checkPermission, isUserSuperAdmin } from '@/lib/rbac'

const PROVIDER_TENANT_ID = 'default'

export type SyslogAdminResult =
  | { denied: Response; userId?: undefined; userEmail?: undefined }
  | { denied: null; userId: string; userEmail: string | null }

export async function requireSyslogAdmin(): Promise<SyslogAdminResult> {
  const session = await getServerSession(authOptions)
  const user = (session as any)?.user as { id?: string; email?: string | null; tenantId?: string } | undefined
  const userId = user?.id
  if (!userId) {
    return { denied: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user?.tenantId !== PROVIDER_TENANT_ID) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return { denied }

  if (!(await isUserSuperAdmin(userId))) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const unlicensed = await requireFeature(Features.SYSLOG_FORWARDING)
  if (unlicensed) return { denied: unlicensed }

  return { denied: null, userId, userEmail: user?.email ?? null }
}
