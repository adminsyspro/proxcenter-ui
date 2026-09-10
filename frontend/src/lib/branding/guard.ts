// src/lib/branding/guard.ts
//
// Access guard for the tenant branding routes (White Label).
//
// Branding is stored per tenant — setSetting('branding', getCurrentTenantId())
// — and a super admin brands a tenant by switching onto it, so this guard
// deliberately does NOT pin the caller to the provider tenant the way
// requireBroadcastAdmin does: whichever tenant the session carries is the
// legitimate target, and getCurrentTenantId() already refuses a tenant the
// caller is not a member of.
//
// What it does pin is WHO. role_tenant_admin carries admin.settings (see the
// rolePermMap in lib/db/sqlite.ts), so checkPermission(ADMIN_SETTINGS) on its
// own would let a tenant admin rewrite their own tenant's white label. Only a
// super admin may, which is the rule the vDC and Tenants tabs already follow.
//
// Order is cheapest-first, as in lib/broadcast/guard.ts: session presence,
// then checkPermission(), then the explicit super-admin read.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { PERMISSIONS, checkPermission, isUserSuperAdmin } from '@/lib/rbac'

/**
 * Returns a 401/403 Response when the caller may not read or write branding,
 * or null when it may. An API token never passes: it carries no session user,
 * and no token scope expands to admin.settings.
 */
export async function requireBrandingAdmin(): Promise<Response | null> {
  const session = await getServerSession(authOptions)
  const userId = (session as any)?.user?.id as string | undefined

  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

  if (denied) return denied

  if (!(await isUserSuperAdmin(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}
