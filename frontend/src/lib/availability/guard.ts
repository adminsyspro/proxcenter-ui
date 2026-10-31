// src/lib/availability/guard.ts
//
// Common gate of the availability and SLA routes, all Enterprise
// (`sla_monitoring`), in this order: session, tenant, licence,
// `connection.view`, then the perimeter (tenant scope narrowed by the RBAC
// grants of `connection.view`). A vDC (iaas) tenant gets a 404: the page is
// for the provider and the tenants that own whole connections. The perimeter and the
// connection list come from the server only; nothing of it is read from the
// request.
//
// Reads follow the vDC view context; writes resolve the tenant's full union,
// like every allow/deny verdict (see getVdcScope).

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { hasServerFeature } from '@/lib/auth/requireEnterprise'
import { prisma } from '@/lib/db/prisma'
import { Features } from '@/lib/license/features'
import { PERMISSIONS, checkPermission, getCurrentRbacInfraScope } from '@/lib/rbac'
import { DEFAULT_TENANT_ID, getCurrentTenantId } from '@/lib/tenant'
import { getTenantInfrastructureScope, pveConnectionFilter } from '@/lib/tenant/infraScope'

import { codeResponse, featureRequired, notFound } from './orchestrator'
import { narrowByRbac, toAvailabilityScope } from './scope'
import type { AvailabilityScope } from './types'

// FLAT on purpose: tsconfig strict:false does not narrow a union on `denied`,
// so the fields are optional-undefined on the refused branch.
export type AvailabilityAccess =
  | {
      denied: Response
      userId?: undefined
      userEmail?: undefined
      tenantId?: undefined
      scope?: undefined
      connectionIds?: undefined
    }
  | {
      denied: null
      userId: string
      userEmail: string
      tenantId: string
      scope: AvailabilityScope | null
      connectionIds: string[]
    }

const notAuthenticated = () => codeResponse('not_authenticated', 401)
const forbidden = () => codeResponse('forbidden', 403)

type SessionUser = { id: string; email: string; tenantId?: string }

async function sessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions)
  const user = (session as { user?: { id?: string; email?: string | null; tenantId?: string } } | null)?.user
  if (!user?.id) return null
  return { id: user.id, email: user.email || user.id, tenantId: user.tenantId }
}

async function resolveAccess(ignoreVdcContext: boolean): Promise<AvailabilityAccess> {
  const user = await sessionUser()
  if (!user) return { denied: notAuthenticated() }

  let tenantId: string
  try {
    tenantId = await getCurrentTenantId()
  } catch {
    return { denied: forbidden() }
  }

  if (!(await hasServerFeature(Features.SLA_MONITORING))) return { denied: featureRequired() }

  const permDenied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
  if (permDenied) return { denied: permDenied }

  const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext })
  if (infra.kind === 'iaas') return { denied: notFound() }
  const visible = pveConnectionFilter(infra)
  const rows = await prisma.connection.findMany({
    where: visible === null ? { type: 'pve' } : { type: 'pve', id: { in: [...visible] } },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const rbac = await getCurrentRbacInfraScope(PERMISSIONS.CONNECTION_VIEW)
  const { scope, connectionIds } = narrowByRbac(toAvailabilityScope(infra), rows.map(r => r.id), rbac)

  return { denied: null, userId: user.id, userEmail: user.email, tenantId, scope, connectionIds }
}

/** The reads (overview, policies, windows), within the vDC view context. */
export async function requireSlaRead(): Promise<AvailabilityAccess> {
  return resolveAccess(false)
}

/** The SLA writes: `alerts.manage` on top, over the tenant's full perimeter. */
export async function requireSlaManage(): Promise<AvailabilityAccess> {
  const access = await resolveAccess(true)
  if (access.denied) return access
  const permDenied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
  if (permDenied) return { denied: permDenied }
  return access
}

export type SettingsAccess = { denied: Response } | { denied: null }

/**
 * The availability settings are provider-wide: a session of another tenant
 * gets a 404 (judged on the session claim AND on getCurrentTenantId, like
 * lib/backups/restoreDrills/guard), then the licence and `admin.settings`.
 */
export async function requireAvailabilitySettingsAccess(): Promise<SettingsAccess> {
  const user = await sessionUser()
  if (!user) return { denied: notAuthenticated() }

  const notFound = { denied: codeResponse('not_found', 404) }
  if (user.tenantId && user.tenantId !== DEFAULT_TENANT_ID) return notFound
  try {
    if ((await getCurrentTenantId()) !== DEFAULT_TENANT_ID) return notFound
  } catch {
    return notFound
  }

  if (!(await hasServerFeature(Features.SLA_MONITORING))) return { denied: featureRequired() }

  const permDenied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (permDenied) return { denied: permDenied }

  return { denied: null }
}
