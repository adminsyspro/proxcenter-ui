import { NextRequest, NextResponse } from "next/server"

import { getCurrentTenantId } from "@/lib/tenant"
import { demoResponse } from "@/lib/demo/demo-api"
import { getRBACContext, filterVmsByPermission, PERMISSIONS, checkPermission, getRbacInfraScope, applyRbacInfraFilter, filterVisibleConnections, filterCandidateConnections, pruneEmptyConnections } from "@/lib/rbac"
import { applyVdcFilter } from "@/lib/vdc/scope"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { getInventorySWR, type ClusterData } from "@/lib/inventory/fetchRawInventory"
import { withPublicApiGuard, type GuardedRouteContext } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

/**
 * GET /api/v1/inventory
 *
 * API agrégée qui retourne l'arbre complet de l'infrastructure en une seule requête.
 * Optimisé avec cache in-memory (TTL 30s) pour éviter de re-requêter Proxmox à chaque appel.
 * Le RBAC est appliqué APRÈS le cache — chaque user reçoit sa vue filtrée.
 *
 * Query params:
 *   ?refresh=true  — force le bypass du cache (bouton refresh manuel, post-action)
 */

/* ------------------------------------------------------------------ */
/* GET handler                                                        */
/* ------------------------------------------------------------------ */

async function handler(request: NextRequest, ctx: GuardedRouteContext) {
  const demo = demoResponse(request)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true'
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)
    const mask = maskingScope(infra)

    // 1) Tenter le cache (sauf si refresh forcé)
    const { raw, cached } = await getInventorySWR(tenantId, infra, forceRefresh)

    // 2) Resolve RBAC context + infra scope once, before any filtering.
    //    A PRINCIPAL, never a synthetic userId (hard gate 1, Task 18): for a
    //    token, getRbacInfraScope/filterVmsByPermission below intersect
    //    token.connectionIds with this already tenant-scoped tree — the
    //    connection perimeter of the aggregated route (spec section 6).
    const rbacCtx = await getRBACContext()
    const rbacPrincipal = rbacCtx?.principal ?? (rbacCtx?.userId as string | undefined)
    const rbacScope = rbacCtx && !rbacCtx.isAdmin && rbacPrincipal
      ? await getRbacInfraScope(rbacPrincipal, rbacCtx.tenantId)
      : null

    // 3) Deep-clone clusters pour le filtrage RBAC (ne pas muter le cache).
    //    Filter by vDC connection scope first, then by RBAC infra scope (intersection).
    let visibleRawClusters = mask ? raw.clusters.filter(c => mask.connectionIds.has(c.id)) : raw.clusters

    // Candidate set only: a guest-derived (tag/pool) scope cannot decide here,
    // the surviving guests below define the real perimeter (issue #633).
    visibleRawClusters = filterCandidateConnections(visibleRawClusters, rbacScope)

    let clusters: ClusterData[] = visibleRawClusters.map(c => ({
      ...c,
      nodes: c.nodes.map(n => ({
        ...n,
        guests: [...n.guests]
      }))
    }))

    // 4) RBAC + vDC: Filter guests by user permissions, then apply both
    //    vDC mask (nodes+pools) and RBAC infra scope (node prune), composed.
    clusters = await Promise.all(clusters.map(async cluster => {
      // Apply RBAC guest filter first (unchanged)
      let filtered = cluster
      if (rbacCtx && !rbacCtx.isAdmin) {
        const filteredNodes = await Promise.all(
          cluster.nodes.map(async node => ({
            ...node,
            guests: await filterVmsByPermission(
              rbacPrincipal as any,
              node.guests.map(g => ({
                ...g,
                connId: cluster.id,
                node: node.node,
                vmid: String(g.vmid),
              })),
              PERMISSIONS.VM_VIEW,
              rbacCtx.tenantId
            )
          }))
        )
        filtered = {
          ...cluster,
          nodes: filteredNodes,
        }
      }
      // Apply vDC filter (nodes + pool membership), then RBAC node prune (composed)
      return applyRbacInfraFilter(applyVdcFilter(filtered, mask), rbacScope)
    }))

    // Drop connections that no longer carry a single node the user may see.
    clusters = pruneEmptyConnections(clusters, rbacScope)

    // 5) Prune PBS servers and external hypervisors by RBAC infra scope (.id = connection id)
    const visiblePbs = filterVisibleConnections(raw.pbsServers, rbacScope)
    const visibleExternalHypervisors = filterVisibleConnections(raw.externalHypervisors, rbacScope)

    // 6) Recalculer les stats après filtrage RBAC
    let totalNodes = 0
    let onlineNodes = 0
    let totalGuests = 0
    let runningGuests = 0

    for (const cluster of clusters) {
      for (const node of cluster.nodes) {
        totalNodes++
        if (node.status === 'online') onlineNodes++

        for (const guest of node.guests) {
          totalGuests++
          if (guest.status === 'running') runningGuests++
        }
      }
    }

    let totalDatastores = 0
    let totalBackups = 0

    for (const pbs of visiblePbs) {
      totalDatastores += pbs.stats.datastoreCount
      totalBackups += pbs.stats.backupCount
    }

    return NextResponse.json({
      data: {
        clusters,
        pbsServers: visiblePbs,
        externalHypervisors: visibleExternalHypervisors,
        cached,
        stats: {
          totalClusters: clusters.length,
          totalNodes,
          totalGuests,
          onlineNodes,
          runningGuests,
          totalPbsServers: visiblePbs.length,
          totalDatastores,
          totalBackups,
        }
      }
    })
  } catch (e: any) {
    console.error('[inventory] Error:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("inventory-tree", handler)
