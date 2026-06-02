// src/lib/reports/connectionScope.ts
// Resolves the connection scope for a report generate/schedule request.
//
// Security model (authoritative; the client selector is UX only):
//   - type === 'vdc'   -> clear connection_ids (cross-tenant report, no scope)
//   - vDC tenant       -> FORCE to the tenant's PVE slice; never empty (reject
//                         422 if the tenant has no PVE connection, so an empty
//                         scope is never sent and read as "all")
//   - provider tenant  -> RESPECT the selection, bounded to existing PVE
//                         connections; empty = all (kept empty); a non-empty
//                         selection that sanitizes to empty is rejected (400),
//                         never widened to all.

import { NextResponse } from 'next/server'

import { getCurrentTenantId, getSessionPrisma } from '@/lib/tenant'
import { isVdcTenant, buildScopePayloadForCurrentTenant, assertReportTypeAllowed } from '@/lib/reports/tenantScope'
import { getVdcScope } from '@/lib/vdc/scope'

/** PVE connection ids reachable by the current tenant (PVE only, no PBS). */
export async function getTenantPveConnectionIds(): Promise<string[]> {
  const tenantId = await getCurrentTenantId()
  const scope = await getVdcScope(tenantId)
  if (scope) {
    // vDC: only the PVE connections of the slice (pbsConnectionIds excluded).
    return [...scope.connectionIds]
  }
  // Provider: directly-owned PVE connections.
  const prisma = await getSessionPrisma()
  const conns = await prisma.connection.findMany({ where: { type: 'pve' }, select: { id: true } })
  return conns.map((c: any) => c.id)
}

/**
 * Mutates body.connection_ids (and, for vDC, the node/vmid/storage filters) in
 * place. Returns a NextResponse to short-circuit the route on rejection, or
 * null when the request may proceed.
 */
export async function resolveReportConnectionScope(body: any): Promise<NextResponse | null> {
  // 1. Report type that does not honor a connection scope (currently 'vdc').
  if (body?.type === 'vdc') {
    delete body.connection_ids
    return null
  }

  // 2. vDC tenant: forced to its PVE slice, never empty.
  if (await isVdcTenant()) {
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

  // 3. Provider: respect the selection, bounded to existing PVE connections.
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
