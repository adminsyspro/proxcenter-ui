// src/lib/broadcast/guard.ts
//
// Write guard for the broadcast admin routes (#607). Deliberately does NOT
// use requireProviderTenant(): that helper resolves the tenant through
// getCurrentTenantId(), which answers "default" when the session tenant is
// missing, disabled, or the user is no longer a member (see
// src/lib/tenant/index.ts:64-85). Since role_tenant_admin carries
// admin.settings, that fallback would promote a tenant admin into the
// provider tenant. We read the raw session claim instead.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { PERMISSIONS, checkPermission, isUserSuperAdmin } from '@/lib/rbac'

const PROVIDER_TENANT_ID = 'default'

export type BroadcastAdminResult =
  | { denied: Response; userId?: undefined }
  | { denied: null; userId: string }

export async function requireBroadcastAdmin(): Promise<BroadcastAdminResult> {
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return { denied }

  const session = await getServerSession(authOptions)
  const userId = (session as any)?.user?.id as string | undefined
  if (!userId) {
    return { denied: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  const rawTenantId = (session as any)?.user?.tenantId
  if (rawTenantId !== PROVIDER_TENANT_ID) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  if (!(await isUserSuperAdmin(userId))) {
    return { denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { denied: null, userId }
}
