// src/lib/tls/guard.ts
//
// Same shape and same reasoning as src/lib/syslog/guard.ts (raw tenant claim
// rather than getCurrentTenantId(), so a tenant admin can never be promoted
// into the provider tenant by the "default" fallback), MINUS the licence gate:
// serving the UI over HTTPS is a Community capability.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { PERMISSIONS, checkPermission, isUserSuperAdmin } from '@/lib/rbac'

const PROVIDER_TENANT_ID = 'default'

export type TlsAdminResult =
  | { denied: Response; userId?: undefined; userEmail?: undefined }
  | { denied: null; userId: string; userEmail: string | null }

export async function requireTlsAdmin(): Promise<TlsAdminResult> {
  const session = await getServerSession(authOptions)
  const user = (session as any)?.user as { id?: string; email?: string | null; tenantId?: string } | undefined
  const userId = user?.id

  if (!userId) return { denied: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  if (user?.tenantId !== PROVIDER_TENANT_ID) return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

  if (denied) return { denied }

  if (!(await isUserSuperAdmin(userId))) return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { denied: null, userId, userEmail: user?.email ?? null }
}
