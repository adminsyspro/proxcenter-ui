import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { demoResponse } from "@/lib/demo/demo-api"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getSessionPrisma } from "@/lib/tenant"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { aggregateStorage } from "@/lib/proxmox/storage"
import { canReadFleetStorage } from "@/lib/storage/fleetScope"
import { buildTenantFacets, selectableTenants } from "@/lib/storage/tenantFacets"
import { withPublicApiGuard, type GuardedRouteContext } from "@/lib/api-tokens/routeGuard"
import { restrictToTokenScope } from "@/lib/api-tokens/scope"

export const runtime = "nodejs"

type PveConnectionRow = { id: string; name: string; tenantId: string }

type UnavailableConnection = {
  connId: string
  connName: string
  tenantId: string
  tenantName: string | null
}

// Shared between the two client branches below: keeping the arguments in one
// place avoids typing the two Prisma clients as a union, since getSessionPrisma()
// returns a $extends client that is not structurally the plain PrismaClient.
const PVE_CONNECTION_QUERY = {
  where: { type: 'pve' as const },
  orderBy: { createdAt: 'desc' as const },
  select: { id: true, name: true, tenantId: true },
}

/**
 * GET /api/v1/storage
 * Récupère tous les storages de toutes les connexions PVE en une seule requête.
 *
 * Portée: par défaut le client Prisma de session, donc les seules connexions du
 * tenant courant. Pour un super-admin du tenant provider (canReadFleetStorage),
 * la liste est élargie à toute la flotte et la réponse porte la facette
 * `tenants`, qui alimente le sélecteur de tenants de /storage/overview
 * (issue #609).
 *
 * Les stockages de vDC ne sont jamais remontés séparément: un stockage de vDC
 * appartient déjà à une connexion, donc il apparaît sous le tenant propriétaire
 * de cette connexion. Le compter une seconde fois fausserait les KPI, qui
 * somment capacité et utilisé sur les lignes affichées (voir #569). Corollaire:
 * un tenant dont la seule portée est un vDC ne figure pas dans la facette
 * `tenants`, sinon le sélecteur porterait une entrée vide en permanence.
 */
async function handler(req: Request, ctx: GuardedRouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    // RBAC: Check storage.view permission
    const denied = await checkPermission(PERMISSIONS.STORAGE_VIEW)

    if (denied) return denied

    // Gate BEFORE canReadFleetStorage() is ever consulted (never merely
    // after): a token principal must not get the fleet branch even when a
    // live super-admin session cookie also rides along on the same request
    // (spec D2 exclusivity; src/proxy.ts strips x-pxc-* but never
    // Cookie). Short-circuit `&&` means the session read itself is never
    // invoked for a token, not just its result discarded.
    const fleet = ctx?.principal?.kind !== "token" && (await canReadFleetStorage())

    // Récupérer uniquement les connexions PVE (pas PBS)
    const rawConnections: PveConnectionRow[] = fleet
      ? await globalPrisma.connection.findMany(PVE_CONNECTION_QUERY)
      : await (await getSessionPrisma()).connection.findMany(PVE_CONNECTION_QUERY)

    // Connection perimeter (spec section 6, hard gate 3, Task 18): tenant
    // scoping alone is not connection scoping. A token restricted to one
    // connection inside a tenant that owns three must still see only one.
    // No-op for a session caller and (verified) for the fleet branch, which
    // canReadFleetStorage() already fails closed for any Bearer request.
    const connections = await restrictToTokenScope(rawConnections, ctx?.principal)

    // Tous les tenants activés, pas seulement ceux qui possèdent une connexion:
    // un tenant MSP sans connexion encore déclarée reste listé et affiche 0.
    const enabledTenants = fleet
      ? await globalPrisma.tenant.findMany({ where: { enabled: true }, select: { id: true, name: true } })
      : []

    // Un tenant dont la seule portée est un vDC est en revanche écarté: le vDC
    // est adossé à une connexion entière appartenant au tenant provider, donc
    // ses stockages figurent déjà sous ce tenant. L'ajouter au sélecteur ne
    // produirait qu'une entrée vide en permanence, soit l'impression de page
    // cassée de l'issue #609. Comme l'exclusion épargne les tenants qui
    // possèdent une connexion, aucune ligne ni entrée `unavailable` ne peut
    // référencer un tenant absent de tenantNameById ci-dessous.
    const vdcTenantIds = fleet
      ? (
          await globalPrisma.vdc.findMany({
            where: { enabled: true },
            select: { tenantId: true },
            distinct: ['tenantId'],
          })
        ).map(v => v.tenantId)
      : []

    const tenants = selectableTenants(enabledTenants, vdcTenantIds, connections)

    const tenantNameById = new Map(tenants.map(t => [t.id, t.name]))

    if (connections.length === 0) {
      return NextResponse.json({
        data: [],
        connections: [],
        unavailable: [],
        ...(fleet ? { tenants: buildTenantFacets(tenants, [], []) } : {}),
      })
    }

    const allStorages: any[] = []
    const unavailable: UnavailableConnection[] = []

    const markUnavailable = (conn: PveConnectionRow) => {
      unavailable.push({
        connId: conn.id,
        connName: conn.name,
        tenantId: conn.tenantId,
        tenantName: tenantNameById.get(conn.tenantId) ?? null,
      })
    }

    // Récupérer les storages de toutes les connexions en parallèle
    await Promise.all(
      connections.map(async (conn) => {
        try {
          const connData = await getConnectionById(conn.id)

          // Récupérer resources et config en parallèle
          const [resourcesResult, configResult] = await Promise.allSettled([
            pveFetch<any[]>(connData, "/cluster/resources"),
            pveFetch<any[]>(connData, "/storage")
          ])

          // /cluster/resources porte la liste des storages: sans lui la connexion
          // ne produit aucune ligne. On le signale au lieu de rétrécir la vue en
          // silence, ce qui ferait mentir la vue agrégée (issue #609).
          if (resourcesResult.status === 'rejected') {
            console.error(`[storage] Error fetching ${conn.name}:`, resourcesResult.reason)
            markUnavailable(conn)

            return
          }

          const resources = resourcesResult.value || []

          // Un rejet du seul /storage dégrade les types en 'unknown' mais laisse
          // les storages visibles: c'est une dégradation, pas une absence.
          const storageConfigs = configResult.status === 'fulfilled' ? configResult.value || [] : []

          const storageResources = resources.filter((r: any) => r?.type === "storage")

          // Créer un map des configs par storage name
          const configMap = new Map<string, any>()

          for (const cfg of storageConfigs) {
            if (cfg?.storage) {
              configMap.set(cfg.storage, cfg)
            }
          }

          // Mapper les storages
          for (const r of storageResources) {
            const config = configMap.get(r.storage) || {}

            allStorages.push({
              connId: conn.id,
              connName: conn.name,
              tenantId: conn.tenantId,
              tenantName: tenantNameById.get(conn.tenantId) ?? null,
              node: r.node,
              storage: r.storage,
              type: config.type || 'unknown',
              shared: config.shared === 1 || config.shared === true,
              used: Number(r.disk || 0),
              total: Number(r.maxdisk || 0),
              content: config.content ? String(config.content).split(',') : [],
              enabled: config.disable !== 1,
              status: r.status || (r.disk !== undefined ? 'available' : 'unknown'),
              path: config.path || null,
              server: config.server || null,
              export: config.export || null,
              pool: config.pool || null,
              monhost: config.monhost || null,
              fsName: config['fs-name'] || null,
              datastore: config.datastore || null,
            })
          }
        } catch (e) {
          console.error(`[storage] Error fetching ${conn.name}:`, e)
          markUnavailable(conn)
        }
      })
    )

    // Agréger les storages: jamais fusionner entre clusters (issue #569);
    // au sein d'un cluster, sommer par node pour les storages locaux et
    // collapser au pool pour les storages partagés (aggregateStorage).
    const result = aggregateStorage(allStorages)

    // Trier: partagés d'abord, puis par utilisation décroissante
    result.sort((a, b) => {
      if (a.shared !== b.shared) return a.shared ? -1 : 1

      return b.usedPct - a.usedPct
    })

    // Calculer les stats globales
    const stats = {
      total: result.length,
      shared: result.filter(s => s.shared).length,
      local: result.filter(s => !s.shared).length,
      byType: {} as Record<string, number>,
      totalCapacity: 0,
      usedCapacity: 0,
    }

    for (const s of result) {
      stats.byType[s.type] = (stats.byType[s.type] || 0) + 1
      stats.totalCapacity += s.total || 0
      stats.usedCapacity += s.used || 0
    }

    return NextResponse.json({
      data: result,
      stats,
      connections: connections.map(c => ({ id: c.id, name: c.name, tenantId: c.tenantId })),
      unavailable,
      ...(fleet ? { tenants: buildTenantFacets(tenants, connections, result) } : {}),
    })
  } catch (e: any) {
    console.error("[storage] Error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("storage-list", handler)
