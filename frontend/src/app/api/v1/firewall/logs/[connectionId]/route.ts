export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/logs/[connectionId]/route.ts
// GET the parsed firewall log of a guest (?scope=vm&node=&vmType=&vmid=), of a
// security group (?scope=group&group=), of a node (?scope=node&node=) or of the
// cluster's host rules (?scope=cluster), over the last `window` seconds
// (ui#1114). See lib/firewall/logs.ts for which PVE log each scope reads.
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import { collectFirewallLog, MAX_SCAN_LINES } from '@/lib/firewall/logs'
import { gateRotatedReads } from '@/lib/firewall/rotatedLogGate'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { guardSessionGuest } from '@/lib/vdc/guestGuard'

import type { FirewallLogScope, LogWindowSec } from '@/lib/firewall/logs'
import type { LogPage, LogPageQuery, LogPageReader } from '@/lib/firewall/logWindow'
import type { Alias, FirewallRule, IPSet, SecurityGroup } from '@/lib/api/firewall'

type RouteContext = { params: Promise<{ connectionId: string }> }

/** The window the UI offers tops out at 7 days; older reads are refused, not clamped. */
const MAX_WINDOW_SEC = 7 * 24 * 3600
const DEFAULT_WINDOW_SEC = 3600

/**
 * A read over the rotated logs through the orchestrator gives up before its
 * 30 s write timeout: past it the orchestrator drops the socket, the call
 * reads as "unavailable" and would be run again on PVE directly (ui#1190).
 */
const ORCHESTRATOR_ROTATED_LOG_TIMEOUT_MS = 25_000

const NODE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/
const GROUP_RE = /^[A-Za-z][A-Za-z0-9_-]*$/

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId } = await ctx.params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "connection", connectionId)
    if (denied) return denied

    const params = new URL(req.url).searchParams
    const windowSec = params.has('window') ? Number(params.get('window')) : DEFAULT_WINDOW_SEC

    if (!Number.isInteger(windowSec) || windowSec <= 0 || windowSec > MAX_WINDOW_SEC) return badRequest('invalid window')

    let scope: FirewallLogScope

    if (params.get('scope') === 'group') {
      const group = params.get('group') || ''

      if (!GROUP_RE.test(group)) return badRequest('invalid group')
      scope = { kind: 'group', group }
    } else if (params.get('scope') === 'vm') {
      const node = params.get('node') || ''
      const vmType = params.get('vmType')
      const vmid = Number(params.get('vmid'))

      if (!NODE_RE.test(node)) return badRequest('invalid node')
      if (vmType !== 'qemu' && vmType !== 'lxc') return badRequest('invalid vmType')
      if (!Number.isInteger(vmid) || vmid <= 0) return badRequest('invalid vmid')

      // node.view is connection-wide: the guest itself must be inside the vDC,
      // as on every other per-guest firewall route.
      const scopeDenied = await guardSessionGuest({ connectionId, conn: () => getConnectionById(connectionId), type: vmType, node, vmid: String(vmid) })

      if (scopeDenied) return scopeDenied
      scope = { kind: 'vm', node, vmType, vmid }
    } else if (params.get('scope') === 'node') {
      const node = params.get('node') || ''

      if (!NODE_RE.test(node)) return badRequest('invalid node')
      scope = { kind: 'node', node }
    } else if (params.get('scope') === 'cluster') {
      scope = { kind: 'cluster' }
    } else {
      return badRequest('scope must be vm, group, node or cluster')
    }

    const window: LogWindowSec = { since: Math.floor(Date.now() / 1000) - windowSec }
    const orchestrator = getOrchestratorClient()
    let conn: ReturnType<typeof getConnectionById> | null = null
    // Loaded once, and only when a PVE call needs it (Community fallback, node list).
    const pve = () => (conn ??= getConnectionById(connectionId))
    // Pages of a log with PVE's line count (see lib/firewall/logWindow.ts).
    const page = (path: string, q: LogPageQuery) => {
      const params = new URLSearchParams({ start: String(q.start ?? 0), limit: String(q.limit), withTotal: '1' })

      if (q.since !== undefined) params.set('since', String(q.since))
      if (q.until !== undefined) params.set('until', String(q.until))
      const scansRotated = q.since !== undefined || q.until !== undefined

      return orchestrator.get<LogPage>(`${path}?${params}`, scansRotated ? ORCHESTRATOR_ROTATED_LOG_TIMEOUT_MS : undefined)
    }

    // One rotated read at a time per node, shared and kept (roadmap#179).
    const gated = (node: string, path: string, read: LogPageReader) =>
      gateRotatedReads(read, { node: `${connectionId}/${node}`, log: path }, MAX_SCAN_LINES)

    const result = await collectFirewallLog(scope, window, {
      vmLog: (node, vmType, vmid) => {
        const path = `/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/log`

        return gated(node, path, q => orchestratorOrPve<LogPage>(
          'firewall/logs',
          () => page(path, q),
          async () => pveDirect.getFirewallLogPage(await pve(), node, q, { vmType, vmid }),
        ))
      },
      nodeLog: node => {
        const path = `/firewall/nodes/${connectionId}/${node}/log`

        return gated(node, path, q => orchestratorOrPve<LogPage>(
          'firewall/logs',
          () => page(path, q),
          async () => pveDirect.getFirewallLogPage(await pve(), node, q),
        ))
      },
      nodes: async () => (await pveFetch<{ node: string; status?: string }[]>(await pve(), '/nodes')) ?? [],
      groups: () => orchestratorOrPve<SecurityGroup[]>(
        'firewall/logs',
        () => orchestrator.get(`/firewall/groups/${connectionId}`),
        async () => pveDirect.getSecurityGroups(await pve()),
      ),
      vmRules: (node, vmType, vmid) => orchestratorOrPve<FirewallRule[]>(
        'firewall/logs',
        () => orchestrator.get(`/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/rules`),
        async () => pveDirect.getVMRules(await pve(), node, vmType, vmid),
      ),
      addressBook: async () => {
        const [aliases, ipsets] = await Promise.all([
          orchestratorOrPve<Alias[]>(
            'firewall/logs',
            () => orchestrator.get(`/firewall/aliases/${connectionId}`),
            async () => pveDirect.getAliases(await pve()),
          ).catch(() => [] as Alias[]),
          orchestratorOrPve<IPSet[]>(
            'firewall/logs',
            () => orchestrator.get(`/firewall/ipsets/${connectionId}`),
            async () => pveDirect.getIPSets(await pve()),
          ).catch(() => [] as IPSet[]),
        ])

        return { aliases: aliases || [], ipsets: ipsets || [] }
      },
    })

    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[firewall/logs] GET error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
