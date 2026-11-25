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
import { denyIaasTenant } from '@/lib/tenant/iaasGuard'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { peekGuestNet, rememberGuestConfig } from '@/lib/inventory/guestDiskTotals'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import { getGuestCoverage, type CoverageGuest, type GuestOptions } from '@/lib/firewall/guestCoverage'
import { listConnectionGuests } from '@/lib/firewall/connectionGuests'
import { connectionSlots } from '@/lib/inventory/connectionPool'

type RouteContext = { params: Promise<{ connectionId: string }> }

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
    // A vDC tenant sees its own guests only: a connection-wide count is not for
    // it. It gets the 404 of every provider infrastructure route
    // (lib/tenant/iaasGuard), before any ownership or permission lookup.
    const iaasDenied = await denyIaasTenant()
    if (iaasDenied) return iaasDenied

    const { connectionId } = await ctx.params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, 'connection', connectionId)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()

    let connData: Promise<any> | null = null
    const conn = () => (connData ??= getConnectionById(connectionId))
    const force = new URL(req.url).searchParams.get('refresh') === '1'

    const { result, computing } = await getGuestCoverage(connectionId, {
      listGuests: () => listConnectionGuests(tenantId, connectionId, conn),
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
