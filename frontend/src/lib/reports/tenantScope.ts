// src/lib/reports/tenantScope.ts
// Report-type restrictions and scope payload builder for vDC tenants.
//
// vDC tenants must only see and generate a curated subset of the report
// catalog (Alerts, Inventory). The provider tenant retains access to every
// type. Both /types listing and POST/PUT validation flow through here to
// keep the rule in one place.
//
// buildScopePayloadFromVdc translates a VdcScope (nodes/storages/pools per
// connection) into the node_filter / vmid_filter / storage_filter envelope
// the Go orchestrator expects in GenerateReportRequest. VMIDs are resolved
// by querying PVE /cluster/resources and filtering by the tenant's pools.

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { DEFAULT_TENANT_ID, getCurrentTenantId } from '@/lib/tenant'
import { isUserSuperAdmin } from '@/lib/rbac'
import { type VdcScope } from '@/lib/vdc/scope'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

export const VDC_ALLOWED_REPORT_TYPES: ReadonlySet<string> = new Set([
  'alerts',
  'inventory',
])

/**
 * Report types that only super_admin may see and generate. Currently this is
 * the cross-tenant 'vdc' report which lists every tenant's vDC + quotas.
 * provider_admin (wildcard role) is intentionally excluded because the report
 * exposes tenant ownership across the whole platform.
 */
export const SUPER_ADMIN_ONLY_REPORT_TYPES: ReadonlySet<string> = new Set([
  'vdc',
])

/**
 * True when the current session belongs to an iaas (vDC) tenant.
 * Returns false for provider and msp tenants: msp tenants get the full
 * report-type set (like provider) and no intra-cluster masking.
 */
export async function isVdcTenant(): Promise<boolean> {
  const tenantId = await getCurrentTenantId()
  if (tenantId === DEFAULT_TENANT_ID) return false
  const { getTenantInfrastructureScope } = await import('@/lib/tenant/infraScope')
  const infra = await getTenantInfrastructureScope(tenantId)
  return infra.kind === 'iaas'
}

/** True when the current session belongs to a user holding role_super_admin. */
export async function isCurrentUserSuperAdmin(): Promise<boolean> {
  const session = await getServerSession(authOptions)
  const userId = (session as any)?.user?.id
  if (!userId) return false
  return await isUserSuperAdmin(userId)
}

/**
 * Validate a report type against the current caller's allow-list.
 *
 * Two gates layered on top of each other:
 *   1. SUPER_ADMIN_ONLY_REPORT_TYPES (e.g. 'vdc') reject any non-super-admin
 *   2. VDC_ALLOWED_REPORT_TYPES gate vDC tenants down to the curated subset
 *
 * Returns a 403 NextResponse when denied, or null when the request is allowed.
 * A missing/empty type is treated as allowed (the orchestrator will reject it).
 */
export async function assertReportTypeAllowed(type: string | undefined | null): Promise<NextResponse | null> {
  if (!type) return null

  if (SUPER_ADMIN_ONLY_REPORT_TYPES.has(type) && !(await isCurrentUserSuperAdmin())) {
    return NextResponse.json(
      { error: `Report type '${type}' is restricted to super administrators` },
      { status: 403 }
    )
  }

  if (!(await isVdcTenant())) return null
  if (VDC_ALLOWED_REPORT_TYPES.has(type)) return null
  return NextResponse.json(
    { error: `Report type '${type}' is not available for this tenant` },
    { status: 403 }
  )
}

/**
 * Filter a list of {type} records down to what the current caller may see.
 * Strips super-admin-only types for non-super-admins, and reduces vDC tenants
 * to VDC_ALLOWED_REPORT_TYPES.
 */
export async function filterReportTypesForTenant<T extends { type: string }>(types: T[]): Promise<T[]> {
  let result = types
  if (!(await isCurrentUserSuperAdmin())) {
    result = result.filter(t => !SUPER_ADMIN_ONLY_REPORT_TYPES.has(t.type))
  }
  if (await isVdcTenant()) {
    result = result.filter(t => VDC_ALLOWED_REPORT_TYPES.has(t.type))
  }
  return result
}

export interface ScopePayload {
  node_filter: Record<string, string[]>
  vmid_filter: Record<string, number[]>
  storage_filter: Record<string, string[]>
}

/**
 * Build the scope payload sent to the Go orchestrator in GenerateReportRequest
 * for the current tenant. Returns null for the provider tenant (no scoping)
 * or when no vDC is configured.
 *
 * VMIDs are computed from PVE /cluster/resources by intersecting each VM's
 * `pool` membership with the tenant's allowed pools. We query each connection
 * once; failures are logged and skipped so a single dead PVE doesn't block
 * report generation across the rest of the scope.
 */
export async function buildScopePayloadForCurrentTenant(): Promise<ScopePayload | null> {
  const tenantId = await getCurrentTenantId()
  const { getTenantInfrastructureScope, maskingScope } = await import('@/lib/tenant/infraScope')
  const scope = maskingScope(await getTenantInfrastructureScope(tenantId))
  if (!scope) return null
  return buildScopePayloadFromVdc(scope, tenantId)
}

async function buildScopePayloadFromVdc(scope: VdcScope, tenantId: string): Promise<ScopePayload> {
  const node_filter: Record<string, string[]> = {}
  const vmid_filter: Record<string, number[]> = {}
  const storage_filter: Record<string, string[]> = {}

  for (const connId of scope.connectionIds) {
    const nodes = scope.nodesByConnection.get(connId)
    if (nodes && nodes.size > 0) node_filter[connId] = Array.from(nodes)

    const storages = scope.storagesByConnection.get(connId)
    if (storages && storages.size > 0) storage_filter[connId] = Array.from(storages)

    const pools = scope.poolsByConnection.get(connId)
    if (pools && pools.size > 0) {
      try {
        const conn = await getConnectionById(connId, tenantId)
        const resources = await pveFetch<any[]>(conn, '/cluster/resources?type=vm')
        if (Array.isArray(resources)) {
          const ids: number[] = []
          for (const r of resources) {
            const vmid = Number(r?.vmid)
            if (!Number.isFinite(vmid)) continue
            if (typeof r?.pool === 'string' && pools.has(r.pool)) {
              ids.push(vmid)
            }
          }
          if (ids.length > 0) vmid_filter[connId] = ids
          else vmid_filter[connId] = [-1] // sentinel: pool exists but is empty → block all VMs
        }
      } catch (err: any) {
        console.warn(`[reports/scope] /cluster/resources lookup failed for ${connId}: ${err?.message || err}`)
      }
    }
  }

  return { node_filter, vmid_filter, storage_filter }
}
