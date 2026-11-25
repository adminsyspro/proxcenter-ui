export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/group-usage/[connectionId]/route.ts
//
// GET: which guests of a connection carry which security group, for the Security Groups tab and for the check made
// before a group is deleted. Proxmox keeps no member list, so this reads the rules of the guests; the load it may put
// on Proxmox is bounded in lib/firewall/groupUsage.ts: one rules call per guest, 4 in flight and 2 per node (the
// connection's pool, shared with the coverage and GET /api/v1/vms), 200 guests, kept 10 min for every viewer.
// `?all=1` reads every guest (the check before a deletion), `?refresh=1` reads again what is older than 30 s.
// Session only: the public API allowlist has no entry for it, so a token is refused upstream.
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient, orchestratorFetch, orchestratorSegment } from '@/lib/orchestrator/client'
import { getCurrentTenantId, verifyConnectionOwnership } from '@/lib/tenant'
import { denyIaasTenant } from '@/lib/tenant/iaasGuard'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import { listConnectionGuests } from '@/lib/firewall/connectionGuests'
import type { CoverageGuest } from '@/lib/firewall/guestCoverage'
import { engineWritesMark, getGroupUsage, type UsageRule } from '@/lib/firewall/groupUsage'
import { connectionSlots } from '@/lib/inventory/connectionPool'

type RouteContext = { params: Promise<{ connectionId: string }> }

/** One guest's firewall rules, with the long read budget: a slow answer is waited for, not taken for a dead node. */
function rulesReader(connectionId: string, conn: () => Promise<any>) {
  const orchestrator = getOrchestratorClient()

  return (g: CoverageGuest) => orchestratorOrPve<UsageRule[]>(
    'firewall/group-usage',
    () => orchestrator.get(`/firewall/vms/${connectionId}/${encodeURIComponent(g.node)}/${g.type}/${encodeURIComponent(g.vmid)}/rules`),
    async () => pveFetch<UsageRule[]>(
      await conn(),
      `/nodes/${encodeURIComponent(g.node)}/${g.type}/${encodeURIComponent(g.vmid)}/firewall/rules`,
      {},
      { slowRead: true },
    ),
  )
}

/**
 * The micro-segmentation engine attaches and removes groups on the guests by itself: its status (one orchestrator
 * read, no Proxmox call) tells when it last wrote. Null without an engine or a policy: nothing to follow.
 */
async function microsegWritesMark(connectionId: string): Promise<string | null> {
  try {
    return engineWritesMark(await orchestratorFetch<unknown>(`/microseg/${orchestratorSegment(connectionId, 'connection id')}/status`))
  } catch {
    return null
  }
}

async function getHandler(req: NextRequest, ctx: RouteContext) {
  try {
    // A vDC tenant sees its own guests only: a connection-wide membership is not for it (lib/tenant/iaasGuard).
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
    const params = new URL(req.url).searchParams

    const { result, computing } = await getGroupUsage(connectionId, {
      listGuests: () => listConnectionGuests(tenantId, connectionId, conn),
      fetchRules: rulesReader(connectionId, conn),
      slots: connectionSlots(connectionId),
      writesMark: () => microsegWritesMark(connectionId),
    }, { force: params.get('refresh') === '1', all: params.get('all') === '1' })

    return NextResponse.json({ ...result, computing })
  } catch (e: any) {
    console.error('[firewall/group-usage] GET error:', e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const GET = getHandler
