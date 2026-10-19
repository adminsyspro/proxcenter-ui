// src/lib/backups/restoreDrills/guard.ts
//
// Common gate of every /api/v1/backups/restore-drills route, in this order:
// authenticated session, provider tenant only (a vDC tenant gets a 404, the
// feature does not exist for it in this lot), then the licence. RBAC comes
// after, per route, because it depends on the resource.
//
// The tenant is judged on the raw session claim AND on getCurrentTenantId():
// the latter falls back to the provider tenant for a disabled tenant, which
// must never open a provider-only feature (same reasoning as lib/syslog/guard).

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { requireFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { DEFAULT_TENANT_ID, getCurrentTenantId } from '@/lib/tenant'

export type RestoreDrillAccess =
  | { denied: Response; userId?: undefined; userEmail?: undefined }
  | { denied: null; userId: string; userEmail: string }

export const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

export async function requireRestoreDrillAccess(): Promise<RestoreDrillAccess> {
  const session = await getServerSession(authOptions)
  const user = (session as any)?.user as { id?: string; email?: string | null; tenantId?: string } | undefined
  if (!user?.id) {
    return { denied: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.tenantId && user.tenantId !== DEFAULT_TENANT_ID) return { denied: NOT_FOUND() }
  let tenantId: string
  try {
    tenantId = await getCurrentTenantId()
  } catch {
    return { denied: NOT_FOUND() }
  }
  if (tenantId !== DEFAULT_TENANT_ID) return { denied: NOT_FOUND() }

  const unlicensed = await requireFeature(Features.BACKUP_RESTORE_DRILLS)
  if (unlicensed) return { denied: unlicensed }

  return { denied: null, userId: user.id, userEmail: user.email || user.id }
}
