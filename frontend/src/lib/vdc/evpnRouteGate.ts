// src/lib/vdc/evpnRouteGate.ts
// Shared gate and error answer of the /api/v1/admin/evpn-zones routes (#1334):
// provider tenant and settings administration, like the stretched networks.

import { NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderTenant } from '@/lib/tenant'

import { mapEvpnZoneError } from './httpErrors'

/**
 * `permission`: admin.settings.vdcs to change a zone, admin.settings.view to
 * read one; admin.settings implies both (issue #1360).
 */
export async function evpnGate(permission: string = PERMISSIONS.ADMIN_SETTINGS_VDCS): Promise<Response | null> {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(permission)
  return denied ?? null
}

export function evpnFail(e: any): NextResponse {
  const { status, message } = mapEvpnZoneError(e)
  return NextResponse.json({ error: message }, { status })
}
