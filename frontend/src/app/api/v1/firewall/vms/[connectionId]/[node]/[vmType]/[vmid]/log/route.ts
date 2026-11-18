export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { orchestratorPath } from '@/lib/orchestrator/path'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { guardSessionGuest } from '@/lib/vdc/guestGuard'
import type { LogPage, LogPageQuery } from '@/lib/firewall/logWindow'

/**
 * The lines of one page of the paged read, and the most it may ask for: the search of the guest panel reads the last
 * 2000 lines at once and filters them in the browser. PVE reads the whole file whatever the count (0.6 s for 20 lines,
 * 0.7 s for 2000 on a 350 000 line log at the lab), so a bigger page costs it no more reads.
 */
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 2000

/** A whole number of at least `min` from the query, or null when absent or not one. */
function wholeParam(params: URLSearchParams, name: string, min: number): number | null {
  const raw = params.get(name)
  if (raw === null || !/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) && n >= min ? n : null
}

/**
 * The newest lines first, a page at a time (`?page=0&size=20`): page 0 holds the last `size` lines of the log, page 1
 * the `size` before them, and so on. PVE counts its lines from the oldest, so the count is read first (a one-line
 * read) unless the caller hands back the `total` of its first page: the pages then stay put while new lines come in,
 * and each later page costs one PVE read. The lines come back oldest first, as PVE gives them.
 */
async function pagedLog(params: URLSearchParams, read: (q: LogPageQuery) => Promise<LogPage>): Promise<LogPage> {
  const page = wholeParam(params, 'page', 0) ?? 0
  const size = Math.min(MAX_PAGE_SIZE, wholeParam(params, 'size', 1) ?? DEFAULT_PAGE_SIZE)
  // The live mode: the lines written since the count it holds (`after`), in one read; a total below it means the log
  // was rotated, the caller then starts over.
  const after = wholeParam(params, 'after', 0)
  if (after !== null) return read({ start: after, limit: size })
  const total = wholeParam(params, 'total', 0) ?? (await read({ start: 0, limit: 1 })).total
  const end = total - page * size
  if (end <= 0) return { total, lines: [] }
  const start = Math.max(0, end - size)
  const { lines } = await read({ start, limit: end - start })
  return { total, lines }
}

type RouteContext = {
  params: Promise<{ connectionId: string; node: string; vmType: string; vmid: string }>
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid } = await ctx.params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "connection", connectionId)
    if (denied) return denied

    // node.view is connection-wide: the guest itself must be inside the vDC.
    const scopeDenied = await guardSessionGuest({ connectionId, conn: () => getConnectionById(connectionId), type: vmType, node, vmid })
    if (scopeDenied) return scopeDenied

    const url = new URL(req.url)

    if (url.searchParams.has('page')) {
      const path = orchestratorPath`/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/log`
      const orchestrator = getOrchestratorClient()
      const read = (q: LogPageQuery) => orchestratorOrPve<LogPage>(
        'firewall/vms/log',
        () => orchestrator.get(`${path}?${new URLSearchParams({ start: String(q.start ?? 0), limit: String(q.limit), withTotal: '1' })}`),
        async () => pveDirect.getFirewallLogPage(await getConnectionById(connectionId), node, q, { vmType, vmid }),
      )
      return NextResponse.json(await pagedLog(url.searchParams, read))
    }

    const limit = url.searchParams.get('limit') || '50'
    const since = Number(url.searchParams.get('since')) || undefined
    const until = Number(url.searchParams.get('until')) || undefined
    const query = new URLSearchParams({ limit })

    if (since) query.set('since', String(since))
    if (until) query.set('until', String(until))

    const orchestrator = getOrchestratorClient()
    const result = await orchestratorOrPve(
      'firewall/vms/log',
      () => orchestrator.get(`${orchestratorPath`/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/log`}?${query}`),
      async () => pveDirect.getVMFirewallLog(await getConnectionById(connectionId), node, vmType, vmid, Number(limit), { since, until }),
    )

    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[firewall/vms/log] GET error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
