// src/lib/incidents/guard.ts
//
// Common gate of the /api/v1/incidents routes, in this order: session, tenant,
// licence (`incidents`), then the permission of the level. The register is for
// the Default tenant only: a session of another tenant gets a 404, judged on
// the session claim AND on getCurrentTenantId (like
// lib/availability/guard requireAvailabilitySettingsAccess). The author comes
// from the session here, never from a request body.

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { hasServerFeature } from '@/lib/auth/requireEnterprise'
import { codeResponse } from '@/lib/availability/orchestrator'
import { Features } from '@/lib/license/features'
import { PERMISSIONS, checkPermission, getCurrentRbacInfraScope } from '@/lib/rbac'
import { DEFAULT_TENANT_ID, getCurrentTenantId } from '@/lib/tenant'

import { visibleIncident } from './alertVisibility'
import { featureRequired, getIncident } from './orchestrator'
import type { IncidentView } from './types'

export type IncidentLevel = 'read' | 'write' | 'admin'

// FLAT on purpose: tsconfig strict:false does not narrow a union on `denied`,
// so the fields are optional-undefined on the refused branch.
export type IncidentAccess =
  | { denied: Response; userId?: undefined; userName?: undefined }
  | { denied: null; userId: string; userName: string }

const PERMISSION_OF_LEVEL = {
  read: PERMISSIONS.ALERTS_VIEW,
  write: PERMISSIONS.ALERTS_MANAGE,
  admin: PERMISSIONS.ADMIN_SETTINGS,
} as const

export async function requireIncidentAccess(level: IncidentLevel): Promise<IncidentAccess> {
  const session = await getServerSession(authOptions)
  const user = (session as { user?: { id?: string; name?: string | null; email?: string | null; tenantId?: string } } | null)?.user
  if (!user?.id) return { denied: codeResponse('not_authenticated', 401) }

  const notFound = { denied: codeResponse('not_found', 404) }
  if (user.tenantId && user.tenantId !== DEFAULT_TENANT_ID) return notFound
  try {
    if ((await getCurrentTenantId()) !== DEFAULT_TENANT_ID) return notFound
  } catch {
    return notFound
  }

  if (!(await hasServerFeature(Features.INCIDENTS))) return { denied: featureRequired() }

  const permDenied = await checkPermission(PERMISSION_OF_LEVEL[level])
  if (permDenied) return { denied: permDenied }

  return { denied: null, userId: user.id, userName: user.name || user.email || user.id }
}

/**
 * The gate of the routes that write to one incident: requireIncidentAccess,
 * then the incident itself must be visible to the caller, as GET shows it
 * (at least one of its alerts in the caller's perimeter). Otherwise a 404
 * not_found and nothing is written: the visibility test used to run on the
 * answer only, after the orchestrator had applied the change (roadmap#223).
 */
export type IncidentWriteAccess =
  | { denied: Response; userId?: undefined; userName?: undefined; view?: undefined }
  | { denied: null; userId: string; userName: string; view: IncidentView }

export async function requireIncidentWrite(id: string, level: 'write' | 'admin' = 'write'): Promise<IncidentWriteAccess> {
  const access = await requireIncidentAccess(level)
  if (access.denied) return { denied: access.denied }

  // admin (delete) is judged on what the caller reads, write on what it manages.
  // A caller nothing restricts writes as before, an incident whose alerts sit
  // on a removed connection included (it could not be deleted otherwise).
  const permission = level === 'admin' ? PERMISSIONS.ALERTS_VIEW : PERMISSIONS.ALERTS_MANAGE
  const full = await getIncident(id)
  const view = (await getCurrentRbacInfraScope(permission)) === null ? full : await visibleIncident(full, permission)
  if (!view) return { denied: codeResponse('not_found', 404) }

  return { denied: null, userId: access.userId as string, userName: access.userName as string, view }
}
