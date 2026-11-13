// src/lib/firewall/providerInfraGuard.ts
// Shared preamble of the routes that act on the provider's cluster
// infrastructure (datacenter and node firewall, cluster-wide micro-segmentation,
// CVE scan). Order matters: a vDC (iaas) tenant gets the same 404 whatever its
// role, before any ownership or permission lookup.
import type { NextResponse } from 'next/server'

import { checkPermission } from '@/lib/rbac'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { denyIaasTenant } from '@/lib/tenant/iaasGuard'

/** The refusal to return, or null when the caller may use `permission` on this connection. */
export async function guardProviderInfra(connectionId: string, permission: string): Promise<Response | NextResponse | null> {
  return (await denyIaasTenant())
    ?? (await verifyConnectionOwnership(connectionId))
    ?? (await checkPermission(permission, 'connection', connectionId))
}
