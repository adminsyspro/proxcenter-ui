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
import { PERMISSIONS, checkPermission } from '@/lib/rbac'
import { DEFAULT_TENANT_ID, getCurrentTenantId } from '@/lib/tenant'

import { featureRequired } from './orchestrator'

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
