export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/coverage/[connectionId]/route.ts
//
// GET: firewall state of the guests of a connection, for the Dashboard, Firewalling > VMs and Security Groups tabs
// (UA44): counts and one row per guest asked (options, NIC flag, VLANs, tags), never the rules. `?refresh=1` asks for new
// figures (served from the cache inside 30 s of the last ones). The load it may put on Proxmox is bounded in
// lib/firewall/guestCoverage.ts: one options call per guest, plus one config call for a guest whose options are on
// and whose NICs the inventory has not read (2 at most), 4 in flight, 2 per node (the connection's pool, shared with
// GET /api/v1/vms), 200 guests, every 10 min.
// Session only: the public API allowlist has no entry for it, so a token is refused upstream.
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { getCurrentTenantId, verifyConnectionOwnership } from '@/lib/tenant'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { getInventoryFromCache } from '@/lib/cache/inventoryCache'
import { pveFetch } from '@/lib/proxmox/client'
import { peekGuestNet, rememberGuestConfig } from '@/lib/inventory/guestDiskTotals'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import { getGuestCoverage, type CoverageGuest, type GuestOptions } from '@/lib/firewall/guestCoverage'
import { connectionSlots } from '@/lib/inventory/connectionPool'

type RouteContext = { params: Promise<{ connectionId: string }> }

function toGuest(raw: any, offlineNodes: Set<string>): CoverageGuest | null {
  if (!raw || raw.template === 1 || raw.template === true) return null
  if (raw.type !== 'qemu' && raw.type !== 'lxc') return null
  if (raw.vmid === undefined || raw.vmid === null || !raw.node) return null

  return {
    vmid: String(raw.vmid),
    node: String(raw.node),
    type: raw.type,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    tags: parseTags(raw.tags),
    offline: offlineNodes.has(String(raw.node)),
  }
}

/** Proxmox gives the tags as one `;` separated string (the inventory keeps that form), lowercased. */
function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string')
  if (typeof raw !== 'string') return []

  return raw.split(/[;,]/).map(t => t.trim()).filter(Boolean)
}

/** A node reported down; a node with no status at all is not taken for one. */
const isDown = (status: unknown) => typeof status === 'string' && status !== '' && status !== 'online'

/**
 * The guests of the connection, with the offline flag of their node: from the inventory the app already keeps (no
 * call), or one /cluster/resources read (guests and nodes) when it is cold. Only the union view of the tenant: a
 * vDC-narrowed entry holds a subset of the guests.
 */
async function listGuests(tenantId: string, connectionId: string, conn: () => Promise<any>): Promise<CoverageGuest[]> {
  const cached = getInventoryFromCache(tenantId, null)
  const cluster = cached.status === 'miss' ? null : cached.data.clusters.find((c: any) => c?.id === connectionId)

  if (cluster) {
    const nodes: any[] = cluster.nodes ?? []
    const offline = new Set(nodes.filter(n => n?.node && isDown(n.status)).map(n => String(n.node)))
    const raw = nodes.flatMap(n => (n?.guests ?? []).map((g: any) => ({ ...g, node: g?.node ?? n?.node })))

    return raw.map(g => toGuest(g, offline)).filter((g): g is CoverageGuest => g !== null)
  }

  const resources: any[] = (await pveFetch<any[]>(await conn(), '/cluster/resources')) ?? []
  const offline = new Set(resources.filter(r => r?.type === 'node' && isDown(r.status)).map(r => String(r.node)))

  return resources.map(r => toGuest(r, offline)).filter((g): g is CoverageGuest => g !== null)
}

/**
 * One guest's firewall options. Direct to Proxmox (Community), the long read budget: a slow answer is waited for
 * instead of dropped while Proxmox still works on it, and is not taken for a dead node (no failover).
 */
function optionsReader(connectionId: string, conn: () => Promise<any>) {
  const orchestrator = getOrchestratorClient()

  return (g: CoverageGuest) => orchestratorOrPve<GuestOptions>(
    'firewall/coverage',
    () => orchestrator.get(`/firewall/vms/${connectionId}/${encodeURIComponent(g.node)}/${g.type}/${encodeURIComponent(g.vmid)}/options`),
    async () => pveFetch<GuestOptions>(
      await conn(),
      `/nodes/${encodeURIComponent(g.node)}/${g.type}/${encodeURIComponent(g.vmid)}/firewall/options`,
      {},
      { slowRead: true },
    ),
  )
}

/**
 * The NIC facts of a guest the inventory has not read: its config, direct to Proxmox with the long read budget, kept
 * in the inventory's config cache (so neither the coverage nor the inventory reads it again before the TTL).
 */
function netReader(connectionId: string, conn: () => Promise<any>) {
  return async (g: CoverageGuest) => {
    const config = await pveFetch<unknown>(
      await conn(),
      `/nodes/${encodeURIComponent(g.node)}/${g.type}/${encodeURIComponent(g.vmid)}/config`,
      {},
      { slowRead: true },
    )

    return rememberGuestConfig(connectionId, g.type, g.vmid, config)
  }
}

async function getHandler(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId } = await ctx.params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, 'connection', connectionId)
    if (denied) return denied

    // A vDC tenant sees its own guests only: a connection-wide count is not for it.
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
    if (infra.kind === 'iaas') {
      return NextResponse.json({ error: 'Firewall coverage is not available to a vDC tenant' }, { status: 403 })
    }

    let connData: Promise<any> | null = null
    const conn = () => (connData ??= getConnectionById(connectionId))
    const force = new URL(req.url).searchParams.get('refresh') === '1'

    const { result, computing } = await getGuestCoverage(connectionId, {
      listGuests: () => listGuests(tenantId, connectionId, conn),
      guestNet: g => peekGuestNet(connectionId, g.type, g.vmid),
      fetchOptions: optionsReader(connectionId, conn),
      fetchNet: netReader(connectionId, conn),
      // The pool GET /api/v1/vms also reads configs through: both together stay at 4 in flight, 2 per node.
      slots: connectionSlots(connectionId),
    }, { force })

    return NextResponse.json({ ...result, computing })
  } catch (e: any) {
    console.error('[firewall/coverage] GET error:', e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const GET = getHandler
