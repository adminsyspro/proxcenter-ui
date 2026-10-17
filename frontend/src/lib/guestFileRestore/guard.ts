// src/lib/guestFileRestore/guard.ts
//
// Guards of the guest file restore routes. The settings write guard has the
// same shape and reasoning as src/lib/syslog/guard.ts (raw tenant claim, not
// getCurrentTenantId(), so a tenant admin can never be promoted into the
// provider tenant by the "default" fallback). The user guard is
// authentication only (Community feature, no licence gate, no orchestrator
// call); the target guard is the RBAC verdict on the VM that receives the
// files.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { resolveVisibleConnectionIds } from '@/lib/api-tokens/scope'
import { authOptions } from '@/lib/auth/config'
import { getPrincipal, rejectionToResponse } from '@/lib/auth/principal'
import type { Principal } from '@/lib/auth/principal'
import { PERMISSIONS, buildVmResourceId, checkPermission, isUserSuperAdmin } from '@/lib/rbac'
import { checkTenantGuestScope } from '@/lib/vdc/guestScope'

import type { GuestRestoreTarget } from './types'

const PROVIDER_TENANT_ID = 'default'

export type GuestFileRestoreAdminResult =
  | { denied: Response; userId?: undefined; userEmail?: undefined }
  | { denied: null; userId: string; userEmail: string | null }

/** PUT settings: provider super admin with ADMIN_SETTINGS. */
export async function requireGuestFileRestoreAdmin(): Promise<GuestFileRestoreAdminResult> {
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

  return { denied: null, userId, userEmail: user?.email ?? null }
}

export type GuestFileRestoreUserResult =
  | { denied: Response; principal?: undefined }
  | { denied: null; principal: Principal }

/** Any authenticated caller. RBAC on the resources comes after. */
export async function requireGuestFileRestoreUser(): Promise<GuestFileRestoreUserResult> {
  const result = await getPrincipal()
  if (!result.ok) return { denied: rejectionToResponse(result.rejection) }
  if (!result.principal) {
    return { denied: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }
  return { denied: null, principal: result.principal }
}

/** BACKUP_RESTORE on the guest that receives the files. */
export async function authorizeRestoreTarget(target: GuestRestoreTarget): Promise<Response | null> {
  return checkPermission(
    PERMISSIONS.BACKUP_RESTORE,
    'vm',
    buildVmResourceId(target.connId, target.node, target.type, String(target.vmid)),
  )
}

/**
 * API tokens only (perimeter "handler" in the allowlist): the connections a
 * restore names sit in nested body fields the token guard does not read, so
 * they are held to the token perimeter here, and a vDC tenant token reaches
 * the guests of its own vDC only. Sessions stay judged by RBAC alone.
 */
export async function denyTokenOutsideRestoreScope(
  principal: Principal,
  conn: Parameters<typeof checkTenantGuestScope>[1],
  target: GuestRestoreTarget,
  sourceConnectionId?: string,
): Promise<Response | null> {
  if (principal.kind !== 'token') return null
  const visible = await resolveVisibleConnectionIds(principal)
  for (const connection of [target.connId, sourceConnectionId]) {
    if (connection !== undefined && !visible.has(connection)) {
      return NextResponse.json({ error: 'Connection not in token scope', connection }, { status: 403 })
    }
  }
  return checkTenantGuestScope(principal.tenantId, conn, target.connId, target.type, target.node, String(target.vmid))
}

/**
 * Whether the caller may aim the SSH restore at any host and see the precise
 * cause of a failed connection: a super admin of the provider tenant, who
 * already reaches the whole infrastructure. Tenant membership alone is not
 * enough (a provider user may hold backup.restore on a few guests only). The
 * tenant comes from the raw session claim (not getCurrentTenantId(), whose
 * "default" fallback could promote a tenant user); API tokens never qualify.
 */
export async function isProviderCaller(principal: Principal): Promise<boolean> {
  if (principal.kind === 'token' || !principal.userId) return false
  const session = await getServerSession(authOptions)
  if ((session as any)?.user?.tenantId !== PROVIDER_TENANT_ID) return false
  return isUserSuperAdmin(principal.userId)
}
