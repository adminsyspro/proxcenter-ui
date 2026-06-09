// src/lib/reports/connectionScope.ts
// Resolves the connection scope for a report generate/schedule request.
//
// Security model (authoritative; the client selector is UX only):
//   - type === 'vdc'   -> clear connection_ids (cross-tenant report, no scope)
//   - iaas (vDC)       -> FORCE to the tenant's PVE slice; never empty (reject
//                         422 if the tenant has no PVE connection, so an empty
//                         scope is never sent and read as "all"); add intra-cluster
//                         node/vmid/storage filters from maskingScope.
//   - msp              -> FORCE to the tenant's OWNED PVE connections; respect a
//                         narrower requested subset bounded to owned; NEVER fall
//                         through to the provider path (whole-fleet leak risk);
//                         no intra-cluster filter (msp sees full clusters).
//   - provider         -> respect the selection, bounded to existing PVE
//                         connections; empty = all (kept empty); a non-empty
//                         selection that sanitizes to empty is rejected (400),
//                         never widened to all.

import { NextResponse } from 'next/server'

import { getCurrentTenantId, getSessionPrisma } from '@/lib/tenant'
import { buildScopePayloadForCurrentTenant, assertReportTypeAllowed } from '@/lib/reports/tenantScope'

/** PVE connection ids reachable by the current tenant (PVE only, no PBS). */
export async function getTenantPveConnectionIds(): Promise<string[]> {
  const tenantId = await getCurrentTenantId()
  const { getTenantInfrastructureScope } = await import('@/lib/tenant/infraScope')
  const infra = await getTenantInfrastructureScope(tenantId)
  if (infra.kind === 'iaas') return [...infra.vdcScope.connectionIds]
  if (infra.kind === 'msp') {
    // Use the session client so it's scoped to the MSP tenant's owned rows.
    const prisma = await getSessionPrisma()
    const conns = await prisma.connection.findMany({ where: { type: 'pve' }, select: { id: true } })
    return conns.map((c: any) => c.id)
  }
  // provider: ALL PVE connections via the global client so the NOC can scope
  // reports to any cluster including MSP-owned ones.
  const { prisma: globalPrisma } = await import('@/lib/db/prisma')
  const conns = await globalPrisma.connection.findMany({ where: { type: 'pve' }, select: { id: true } })
  return conns.map((c: any) => c.id)
}

/**
 * Mutates body.connection_ids (and, for iaas, the node/vmid/storage filters)
 * in place. Returns a NextResponse to short-circuit the route on rejection, or
 * null when the request may proceed.
 */
export async function resolveReportConnectionScope(body: any): Promise<NextResponse | null> {
  // 1. Report type that does not honor a connection scope (currently 'vdc').
  if (body?.type === 'vdc') {
    delete body.connection_ids
    return null
  }

  const tenantId = await getCurrentTenantId()
  const { getTenantInfrastructureScope } = await import('@/lib/tenant/infraScope')
  const infra = await getTenantInfrastructureScope(tenantId)

  // 2. iaas (vDC): forced to its PVE slice, never empty, + intra-cluster filter.
  if (infra.kind === 'iaas') {
    const pve = await getTenantPveConnectionIds()
    if (pve.length === 0) {
      return NextResponse.json(
        { error: 'No reachable PVE connection for this tenant' },
        { status: 422 }
      )
    }
    body.connection_ids = pve
    const scope = await buildScopePayloadForCurrentTenant()
    if (scope) {
      body.node_filter = scope.node_filter
      body.vmid_filter = scope.vmid_filter
      body.storage_filter = scope.storage_filter
    }
    return null
  }

  // 3. msp: forced to its OWNED PVE connections, never empty/all (no whole-fleet
  //    leak); respect a narrower selection bounded to owned; NO intra-cluster
  //    filter (msp owns whole clusters).
  if (infra.kind === 'msp') {
    const owned = await getTenantPveConnectionIds()
    if (owned.length === 0) {
      return NextResponse.json(
        { error: 'No reachable PVE connection for this tenant' },
        { status: 422 }
      )
    }
    const requested: string[] = Array.isArray(body?.connection_ids)
      ? body.connection_ids.filter((x: unknown) => typeof x === 'string')
      : []
    if (requested.length === 0) {
      body.connection_ids = owned
    } else {
      const allowed = new Set(owned)
      const sanitized = requested.filter((id) => allowed.has(id))
      if (sanitized.length === 0) {
        return NextResponse.json(
          { error: 'None of the selected connections are valid for this tenant' },
          { status: 400 }
        )
      }
      body.connection_ids = sanitized
    }
    return null
  }

  // 4. provider: respect the selection, bounded to existing PVE connections; empty = all.
  const requested: string[] = Array.isArray(body?.connection_ids)
    ? body.connection_ids.filter((x: unknown) => typeof x === 'string')
    : []
  if (requested.length === 0) {
    body.connection_ids = [] // empty = whole fleet
    return null
  }
  const allowed = new Set(await getTenantPveConnectionIds())
  const sanitized = requested.filter((id) => allowed.has(id))
  if (sanitized.length === 0) {
    return NextResponse.json(
      { error: 'None of the selected connections are valid PVE connections' },
      { status: 400 }
    )
  }
  body.connection_ids = sanitized
  return null
}

/**
 * Shared guard for the report generate + schedule (create/update) routes:
 * enforce the per-tenant report-type allow-list, then resolve the connection
 * scope. Returns a NextResponse to short-circuit the route on rejection, or
 * null to proceed. Centralised so the three routes stay in sync (and so the
 * scope logic is exercised by one set of tests rather than duplicated inline).
 */
export async function applyReportRequestScope(body: any): Promise<NextResponse | null> {
  const typeDenied = await assertReportTypeAllowed(body?.type)
  if (typeDenied) return typeDenied
  return resolveReportConnectionScope(body)
}
