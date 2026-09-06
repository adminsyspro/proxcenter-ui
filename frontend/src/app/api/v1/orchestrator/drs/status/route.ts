// src/app/api/v1/orchestrator/drs/status/route.ts
import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS, getCurrentRbacInfraScope } from "@/lib/rbac"
import { isFlatRecordVisible } from "@/lib/rbac/infraScope"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

// GET /api/v1/orchestrator/drs/status — tenant-scoped
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")
    if (denied) return denied

    const tenantConnectionIds = await getTenantConnectionIds()
    const rbacScope = await getCurrentRbacInfraScope(PERMISSIONS.CONNECTION_VIEW)
    const client = getOrchestratorClient()

    // Fetch recommendations + migrations to recompute counts for tenant
    const [statusRes, recsRes, migsRes] = await Promise.all([
      client.getDRSStatus(),
      client.getRecommendations(false).catch(() => ({ data: [] })),
      client.getActiveMigrations().catch(() => ({ data: [] })),
    ])

    const recs = Array.isArray(recsRes.data) ? recsRes.data : []
    const migs = Array.isArray(migsRes.data) ? migsRes.data : []

    const filteredRecs = recs.filter((r: any) => !r.connection_id || tenantConnectionIds.has(r.connection_id))
    const filteredMigs = migs.filter((m: any) => !m.connection_id || tenantConnectionIds.has(m.connection_id))

    const status: Record<string, any> = statusRes.data || {}

    // The orchestrator answers cluster-wide: this route is the tenant
    // boundary. Anything it spreads verbatim leaks, so every row-shaped field
    // has to be filtered here, not just the counts.
    //
    // pinned_guests and balancing_domains name guests and nodes, so unlike
    // the recommendation and migration filters above they are fail-CLOSED: a
    // row without a connection_id is dropped rather than shown to everyone.
    // They also go through the RBAC infra scope, not just the tenant: these
    // are the first DRS status fields to carry guest names, and a user scoped
    // to one connection or one node has no business reading the others'.
    const ownedRows = (rows: unknown): any[] =>
      (Array.isArray(rows) ? rows : []).filter(
        (row: any) => row?.connection_id && tenantConnectionIds.has(row.connection_id)
      )

    // A pinned guest names both a node and a guest, so the row-level gate can
    // decide it outright.
    const pinnedGuests = ownedRows(status.pinned_guests).filter((g: any) =>
      isFlatRecordVisible(rbacScope, { connId: g.connection_id, node: g.node, vmid: g.vmid, nodeBound: true })
    )

    // A domain names a set of nodes and no guest. It is kept only when every
    // node it names is visible: showing a partially visible domain would leak
    // the names of nodes the caller has no grant on.
    const balancingDomains = ownedRows(status.balancing_domains).filter((d: any) => {
      const nodes: string[] = Array.isArray(d.nodes) ? d.nodes : []

      if (nodes.length === 0) return false

      return nodes.every(node =>
        isFlatRecordVisible(rbacScope, { connId: d.connection_id, node, nodeBound: true })
      )
    })

    return NextResponse.json({
      ...status,
      recommendations: filteredRecs.length,
      active_migrations: filteredMigs.length,
      pending_count: filteredRecs.filter((r: any) => r.status === 'pending').length,
      approved_count: filteredRecs.filter((r: any) => r.status === 'approved').length,
      pinned_guests: pinnedGuests,
      pinned_guest_count: pinnedGuests.length,
      balancing_domains: balancingDomains,
    })
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching DRS status:", e)
    }

    // Retourner un status par défaut en cas d'erreur
    return NextResponse.json({
      enabled: false,
      mode: 'manual',
      recommendations: 0,
      active_migrations: 0,
      pending_count: 0,
      approved_count: 0,
      pinned_guests: [],
      pinned_guest_count: 0,
      balancing_domains: []
    })
  }
}
