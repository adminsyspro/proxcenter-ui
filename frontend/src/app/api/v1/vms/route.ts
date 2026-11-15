import { NextResponse } from "next/server"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getRBACContext, filterVmsByPermission, PERMISSIONS, checkPermission } from "@/lib/rbac"
import { formatBytes, formatUptime } from "@/utils/format"
import { getTenantInfrastructureScope, inventoryConnectionPlan, maskingScope } from "@/lib/tenant/infraScope"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { parseVmConfig, probeGuestAgent } from "@/lib/inventory/vmConfig"
import { attachGuestIps } from "@/lib/inventory/guestIpIndex"
import { EMPTY_GUEST_NET_IDENTITY } from "@/lib/inventory/guestNetIdentity"
import { peekGuestConfigFacts } from "@/lib/inventory/guestDiskTotals"
import { fillGuestConfigs, getGuestListing, takeForcedRefresh } from "@/lib/inventory/vmsListing"
import { mapWithConcurrency } from "@/lib/inventory/concurrency"
import { POOL_GLOBAL_CONCURRENCY, withConnectionSlot } from "@/lib/inventory/connectionPool"
import { withPublicApiGuard, type GuardedRouteContext } from "@/lib/api-tokens/routeGuard"
import { restrictToTokenScope } from "@/lib/api-tokens/scope"

export const runtime = "nodejs"

/**
 * GET /api/v1/vms
 *
 * API agrégée qui retourne toutes les VMs et LXCs de toutes les connexions PVE.
 * Optimisé pour charger toutes les données en parallèle.
 * Les IPs sont chargées séparément via /api/v1/vms/ips pour ne pas ralentir.
 * `ips`/`macs` (recherche, #223/#861) viennent de la config déjà lue plus de
 * l'index d'adresses live rafraîchi en arrière-plan : jamais d'appel bloquant.
 *
 * PVE load (UA52): the guest list is read at most every 15 s per connection
 * and shared by concurrent callers; the config fields come from the guest
 * config cache (guestDiskTotals, 15 min), and only a guest missing from it is
 * read, through the connection's pool (4 in flight, 2 per node). See
 * lib/inventory/vmsListing.ts. `?refresh=1` reads everything again, at most
 * once per 30 s per connection. `cached_at`: the oldest read served; `partial`:
 * some guest is served without fresh config fields, or a list read failed.
 */

/**
 * `vmids=100,101`: only these guests are enriched (#1163, the inventory export
 * asks for its rows in batches so no request reads a whole fleet's configs).
 * null when absent or empty: every guest.
 */
function parseVmidFilter(raw: string | null): Set<string> | null {
  const ids = (raw ?? '').split(',').map(id => id.trim()).filter(Boolean)

  return ids.length > 0 ? new Set(ids) : null
}

function round1(n: number) {
  return Math.round((n + Number.EPSILON) * 10) / 10
}

/** include=agent: probes not started after this are left unknown (roadmap#179). */
const AGENT_PROBE_BUDGET_MS = 25_000
/** The configs still being read past this are served from the older cache entry (or without), `partial` (nginx cuts at 60 s). */
const CONFIG_WAIT_MS = 25_000

/** Resolves when `p` does, or after `ms`, whichever comes first; `p` goes on. */
async function waitAtMost(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([p, new Promise<void>(resolve => { timer = setTimeout(resolve, ms) })])
    .finally(() => clearTimeout(timer))
}

type MappedVm = { vmid: string; node: string; type: string; status: string; maxdisk: number }

/** The config fields of each guest from the cache, and what that says of the answer. */
function withCachedConfig<T extends MappedVm>(connId: string, vms: T[]) {
  let partial = false
  let oldest = Number.POSITIVE_INFINITY
  const rows = vms.map(vm => {
    const cached = peekGuestConfigFacts(connId, vm.type === 'lxc' ? 'lxc' : 'qemu', vm.vmid, { maxdisk: vm.maxdisk })
    if (!cached) {
      partial = true
      return { ...vm, ...parseVmConfig(null), ...EMPTY_GUEST_NET_IDENTITY, diskTotal: undefined as number | undefined }
    }
    if (!cached.fresh) partial = true
    oldest = Math.min(oldest, cached.readAt)
    return { ...vm, ...cached.facts, diskTotal: cached.diskTotal as number | undefined }
  })

  return { rows, partial, oldest }
}

/** Agent probes (include=agent, the inventory export): only running qemu guests with the flag, in the connection's pool. */
function withAgentProbes<T extends MappedVm & { agentEnabled: boolean }>(connId: string, connData: any, vms: T[], deadline?: number) {
  return mapWithConcurrency(vms, POOL_GLOBAL_CONCURRENCY, async vm => {
    const eligible = vm.type === 'qemu' && vm.status === 'running' && vm.agentEnabled
    const probe = eligible
      ? await withConnectionSlot(connId, vm.node, () => probeGuestAgent(connData, vm, true, deadline))
      : await probeGuestAgent(connData, vm, false, deadline)
    return { ...vm, ...probe }
  })
}

async function handler(req: Request, ctx: GuardedRouteContext) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    const url = new URL(req.url)
    const connIdFilter = url.searchParams.get('connId')
    const includeAgent = url.searchParams.get('include') === 'agent'
    const agentDeadline = includeAgent ? Date.now() + AGENT_PROBE_BUDGET_MS : undefined
    const vmidFilter = parseVmidFilter(url.searchParams.get('vmids'))
    const refreshAsked = url.searchParams.get('refresh') === '1'

    // Resolve infrastructure scope once; used for both connection enumeration
    // and vDC masking later. Provider and MSP avoid calling getVdcScope.
    const tenantId = await getCurrentTenantId()
    // API tokens never depend on the browser view-context cookie
    // (shared cookie jar case) — global ruling n°4.
    const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: ctx?.principal?.kind === 'token' })
    const plan = inventoryConnectionPlan(infra)
    const connPrisma = plan.pveClient === 'global' ? globalPrisma : prisma

    // Récupérer les connexions PVE
    let connections = await connPrisma.connection.findMany({
      where: { type: 'pve' },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, tenantId: true },
    })

    // For iaas, restrict to the vDC-referenced connection ids
    if (plan.pveConnectionIds) {
      const allowed = new Set(plan.pveConnectionIds)
      connections = connections.filter(c => allowed.has(c.id))
    }

    // Aggregated route: the token connection perimeter is applied where we
    // ENUMERATE, because no connection id ever reaches checkPermission here
    // (spec section 6, allowlist review checklist D8). No-op for a session
    // caller (ctx.principal is only ever set for a token, see routeGuard.ts).
    connections = await restrictToTokenScope(connections, ctx?.principal)

    if (!connections.length) {
      return NextResponse.json({
        data: {
          vms: [],
          stats: { total: 0, running: 0, stopped: 0, paused: 0 },
          cached_at: null,
          partial: false,
        }
      })
    }

    // Filtrer si nécessaire
    const targetConnections = connIdFilter && connIdFilter !== '*'
      ? connections.filter(c => c.id === connIdFilter)
      : connections

    // True while a connection's address index is being built for the first
    // time: the palette re-fetches once so the IPs show up without a reload.
    let ipIndexWarming = false
    let partial = false
    let oldestRead = Number.POSITIVE_INFINITY

    // Charger toutes les connexions EN PARALLÈLE
    const connectionPromises = targetConnections.map(async (conn) => {
      try {
        const connData = await getConnectionById(conn.id, (conn as any).tenantId)

        if (!connData.baseUrl || !connData.apiToken) return []

        // cluster/resources and nodes: the last read of the connection when
        // younger than 15 s, or the read running, else 2 calls.
        const force = refreshAsked && takeForcedRefresh(conn.id)
        const listing = await getGuestListing(conn.id, connData, { force })

        const resources = listing.resources
        // A rejected /nodes leaves node status UNKNOWN, not "everyone offline":
        // `onlineNodes` stays null so the configs are still read instead of
        // fabricating nulls for a connection that is otherwise reachable
        // (resources succeeded).
        const nodes = listing.nodes

        const isCluster = nodes.length > 1
        const onlineNodes = listing.nodesOk
          ? new Set(
              nodes.filter((n: any) => n?.status === 'online' && n?.node).map((n: any) => String(n.node)),
            )
          : null

        // Transformer les resources en format attendu
        const listed = vmidFilter ? resources.filter((r: any) => vmidFilter.has(String(r.vmid))) : resources
        const mapped = listed.map((r: any) => {
          const cpuPct = round1(Number(r.cpu || 0) * 100)
          const ramPct = r.maxmem ? round1((Number(r.mem || 0) / Number(r.maxmem)) * 100) : 0

          return {
            id: `${conn.id}:${r.type}:${r.node}:${r.vmid}`,
            connId: conn.id,
            connectionName: conn.name,
            scope: isCluster ? 'cluster' : 'standalone',
            type: r.type || 'qemu',
            node: r.node || '',
            host: r.node || '-',
            vmid: String(r.vmid || r.id || ''),
            name: r.name || `${r.type}/${r.vmid}`,
            status: r.status || 'unknown',
            cpu: cpuPct,
            ram: ramPct,
            ramUsed: Number(r.mem || 0),
            ramMax: Number(r.maxmem || 0),
            maxmem: Number(r.maxmem || 0),
            maxdisk: Number(r.maxdisk || 0),
            ramUsedFormatted: formatBytes(Number(r.mem || 0)),
            ramMaxFormatted: formatBytes(Number(r.maxmem || 0)),
            diskGb: round1(Number(r.maxdisk || 0) / 1073741824),
            uptime: formatUptime(r.uptime),
            uptimeSeconds: Number(r.uptime || 0),
            template: r.template === 1,
            tags: r.tags ? String(r.tags).split(';').filter(Boolean) : [],
            pool: r.pool || null,
            netvmid: r.netvmid,
            lock: r.lock || undefined,
            ip: null, // Chargé séparément via /api/v1/vms/ips
          }
        })

        // Only the guests with no cached config (or past its TTL) are read.
        await waitAtMost(fillGuestConfigs(conn.id, connData, mapped, onlineNodes, { force }), CONFIG_WAIT_MS)
        const cached = withCachedConfig(conn.id, mapped)
        if (cached.partial || !listing.resourcesOk) partial = true
        oldestRead = Math.min(oldestRead, cached.oldest, listing.at)

        // The agent probes queue behind the node's pvedaemon slots: past this
        // budget the rest is left unknown, so the route stays under nginx's 60 s.
        const configured = includeAgent ? await withAgentProbes(conn.id, connData, cached.rows, agentDeadline) : cached.rows
        const enriched = configured
          // #938: `diskGb` is the VM's disk size, so every disk of it, not the
          // boot disk `maxdisk` names. Never below maxdisk, and maxdisk alone
          // when the config could not be read.
          .map(vm => ({ ...vm, diskGb: round1(Math.max(Number(vm.diskTotal) || 0, vm.maxdisk) / 1073741824) }))
        // A rejected /cluster/resources gave an EMPTY `mapped`: reading the
        // index is fine, rebuilding it from that list is not.
        // A vmids subset is not the connection's guest list either.
        const { vms: withIps, warming } = attachGuestIps(conn.id, connData, enriched, {
          refresh: listing.resourcesOk && !vmidFilter,
        })
        if (warming) ipIndexWarming = true

        return withIps
      } catch (e) {
        console.error(`[vms] Error fetching connection ${conn.id}:`, e)
        partial = true
        
return []
      }
    })

    const results = await Promise.all(connectionPromises)
    let allVms = results.flat()

    // RBAC: Filtrer les VMs selon les permissions
    const rbacCtx = await getRBACContext()

    if (rbacCtx && !rbacCtx.isAdmin) {
      allVms = await filterVmsByPermission(
        rbacCtx.principal ?? (rbacCtx.userId as string),
        allVms,
        PERMISSIONS.VM_VIEW,
        rbacCtx.tenantId,
      )
    }

    // vDC filtering: restrict VMs to those in the tenant's vDC pools
    // (infra and tenantId already resolved above)
    const vdcScope = maskingScope(infra)

    if (vdcScope) {
      allVms = allVms.filter(vm => {
        const pools = vdcScope.poolsByConnection.get(vm.connId)
        if (!pools) return false // connection not in any vDC
        return vm.pool != null && pools.has(vm.pool)
      })
    }

    // Trier par vmid
    allVms.sort((a, b) => {
      const aId = Number.parseInt(a.vmid, 10) || 0
      const bId = Number.parseInt(b.vmid, 10) || 0

      
return aId - bId
    })

    // Stats
    const stats = {
      total: allVms.length,
      running: allVms.filter(v => v.status === 'running').length,
      stopped: allVms.filter(v => v.status === 'stopped').length,
      paused: allVms.filter(v => v.status === 'paused').length,
      templates: allVms.filter(v => v.template).length,
      qemu: allVms.filter(v => v.type === 'qemu').length,
      lxc: allVms.filter(v => v.type === 'lxc').length,
    }

    return NextResponse.json({
      data: {
        vms: allVms,
        stats,
        ipIndexWarming,
        cached_at: Number.isFinite(oldestRead) ? new Date(oldestRead).toISOString() : null,
        partial,
      }
    })
  } catch (e: any) {
    console.error("[vms] Error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("vms-list", handler)
