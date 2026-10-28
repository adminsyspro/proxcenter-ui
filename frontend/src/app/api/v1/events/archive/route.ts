import { NextResponse } from 'next/server'

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { getSessionPrisma } from '@/lib/tenant'
import { prisma as globalPrisma } from '@/lib/db/prisma'
import { checkPermission, PERMISSIONS, getCurrentRbacInfraScope } from '@/lib/rbac'
import { filterCandidateConnections, isFlatRecordVisible, type RbacInfraScope } from '@/lib/rbac/infraScope'
import { getTenantInfrastructureScope, inventoryConnectionPlan, maskingScope } from '@/lib/tenant/infraScope'
import { getVdcVmidsByConnection } from '@/lib/alerts/vdcVmids'
import { findTaskInitiators } from '@/lib/audit/taskInitiators'
import { getPrincipal } from '@/lib/auth/principal'
import {
  ARCHIVE_NODE_LIMIT,
  matchesArchiveFilters,
  mergeArchiveTasks,
  parseArchiveQuery,
  summarizeArchive,
  toArchiveTask,
  type ArchiveTask,
  type PveTaskEntry,
} from '@/lib/tasks/archive'
import { scopeConnectionTasks } from '@/lib/tasks/scopeTasks'

export const runtime = 'nodejs'

const NODE_TIMEOUT_MS = 20_000

type GuestInfo = { name: string | null; type: 'qemu' | 'lxc' | null; status: string | null }

function guestKind(type: unknown): GuestInfo['type'] {
  if (type === 'lxc' || type === 'qemu') return type

  return null
}

/**
 * A node the caller's tree shows: an offline or failing node is only reported
 * to a scoped user when its name is already theirs to see.
 */
function nodeInTree(scope: RbacInfraScope | null, connId: string, node: string): boolean {
  if (!scope || scope.guestDerived || scope.fullConnections.has(connId)) return true

  return scope.nodesByConnection.get(connId)?.has(node) ?? false
}

/**
 * GET /api/v1/events/archive (#1225): the task history each node keeps,
 * filtered by period, family, status, node and guest, newest first and paged.
 * Same perimeter as the live Events feed: connection.view, vDC nodes and
 * pools, RBAC infra scope. Nothing is stored on our side, the retention is the
 * one Proxmox applies on each node.
 */
export async function GET(req: Request) {
  try {
    const sessionPrisma = await getSessionPrisma()
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (permError) return permError

    const { getCurrentTenantId } = await import('@/lib/tenant')
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)
    const plan = inventoryConnectionPlan(infra)
    const vdcScope = maskingScope(infra)
    const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId) : null
    const rbacScope = await getCurrentRbacInfraScope(PERMISSIONS.CONNECTION_VIEW)

    const nowSec = Math.floor(Date.now() / 1000)
    const query = parseArchiveQuery(new URL(req.url).searchParams, nowSec)

    const connPrisma = plan.pveClient === 'global' ? globalPrisma : sessionPrisma
    const connWhere: any = { type: 'pve' }
    if (plan.pveConnectionIds) connWhere.id = { in: plan.pveConnectionIds }
    const connections = filterCandidateConnections(
      await connPrisma.connection.findMany({ where: connWhere, select: { id: true, name: true, tenantId: true } }),
      rbacScope,
    )

    const nodeOptions: { connectionId: string; node: string; status: string }[] = []
    const unavailable: { connectionName: string; node: string }[] = []
    const collected: ArchiveTask[] = []
    let truncated = false

    await Promise.all(
      connections
        .filter(conn => !query.connectionId || conn.id === query.connectionId)
        .map(async conn => {
          try {
            const connection = await getConnectionById(conn.id, conn.tenantId)
            const allowedNodes = vdcScope?.nodesByConnection.get(conn.id)

            const [nodes, resources] = await Promise.all([
              pveFetch<{ node: string; status?: string }[]>(connection, '/nodes'),
              pveFetch<any[]>(connection, '/cluster/resources?type=vm').catch(() => []),
            ])

            const nodeStatus = new Map<string, string>()
            const visibleNodes = (Array.isArray(nodes) ? nodes : []).filter(n =>
              (!allowedNodes || allowedNodes.has(n.node)) && isFlatRecordVisible(rbacScope, { connId: conn.id, node: n.node }),
            )
            const readableNodes = (Array.isArray(nodes) ? nodes : []).filter(n => !allowedNodes || allowedNodes.has(n.node))

            for (const n of readableNodes) nodeStatus.set(n.node, n.status || 'unknown')
            for (const n of visibleNodes) nodeOptions.push({ connectionId: conn.id, node: n.node, status: n.status || 'unknown' })

            const guests = new Map<string, GuestInfo>()
            for (const r of Array.isArray(resources) ? resources : []) {
              if (r.vmid == null) continue
              guests.set(String(r.vmid), {
                name: r.name || null,
                type: guestKind(r.type),
                status: r.status || null,
              })
            }

            const params = new URLSearchParams({
              source: 'all',
              since: String(query.since),
              until: String(query.until),
              limit: String(ARCHIVE_NODE_LIMIT),
            })
            if (query.vmid) params.set('vmid', query.vmid)

            await Promise.all(
              readableNodes
                .filter(n => !query.node || n.node === query.node)
                .map(async n => {
                  // An offline node cannot serve its archive: say so instead
                  // of returning a silently shorter history.
                  if (n.status && n.status !== 'online') {
                    if (nodeInTree(rbacScope, conn.id, n.node)) unavailable.push({ connectionName: conn.name, node: n.node })
                    return
                  }
                  try {
                    const entries = await pveFetch<PveTaskEntry[]>(
                      connection,
                      `/nodes/${encodeURIComponent(n.node)}/tasks?${params}`,
                      {},
                      { timeoutMs: NODE_TIMEOUT_MS },
                    )
                    if (!Array.isArray(entries)) return
                    if (entries.length >= ARCHIVE_NODE_LIMIT) truncated = true

                    const scoped = scopeConnectionTasks(entries, {
                      connId: conn.id,
                      allowedNodes,
                      allowedVmids: vdcVmids?.get(conn.id),
                      rbacScope,
                    })
                    for (const entry of scoped) {
                      const task = toArchiveTask(entry, { connectionId: conn.id, connectionName: conn.name, nowSec, guests, nodeStatus })
                      // Status is filtered after the summary, so its counters
                      // keep showing every status of the window.
                      if (matchesArchiveFilters(task, { ...query, status: 'all' })) collected.push(task)
                    }
                  } catch (e) {
                    console.error(`Task archive error for ${conn.name}/${n.node}:`, e)
                    if (nodeInTree(rbacScope, conn.id, n.node)) unavailable.push({ connectionName: conn.name, node: n.node })
                  }
                }),
            )
          } catch (e) {
            console.error(`Task archive connection error ${conn.name}:`, e)
            unavailable.push({ connectionName: conn.name, node: '' })
          }
        }),
    )

    const inWindow = mergeArchiveTasks(collected)
    const merged = query.status === 'all' ? inWindow : inWindow.filter(t => t.statusClass === query.status)
    const lastPage = Math.max(0, Math.ceil(merged.length / query.pageSize) - 1)
    const page = Math.min(query.page, lastPage)
    const rows = merged.slice(page * query.pageSize, (page + 1) * query.pageSize)

    // Attach the ProxCenter user behind each task of the page (roadmap#41),
    // same rule as the live feed: without admin.audit, one's own actions only.
    if (rows.length > 0) {
      try {
        const oldest = Math.min(...rows.map(r => new Date(r.ts).getTime()))
        const readsJournal = !(await checkPermission(PERMISSIONS.ADMIN_AUDIT))
        const self = readsJournal ? null : (await getPrincipal()).principal
        const onlyFor = readsJournal ? undefined : { userId: self?.userId, apiTokenId: self?.tokenId }
        const initiators = await findTaskInitiators(
          rows.map(r => r.id),
          { tenantId: infra.kind === 'provider' ? null : tenantId, since: new Date(oldest - 60_000), onlyFor },
        )
        for (const row of rows) {
          const initiator = initiators.get(row.id)
          if (initiator) row.initiatedBy = initiator
        }
      } catch (e) {
        console.error('Task archive attribution error:', e)
      }
    }

    nodeOptions.sort((a, b) => a.node.localeCompare(b.node))
    unavailable.sort((a, b) => a.connectionName.localeCompare(b.connectionName) || a.node.localeCompare(b.node))

    return NextResponse.json({
      data: rows,
      meta: {
        total: merged.length,
        page,
        pageSize: query.pageSize,
        since: query.since,
        until: query.until,
        truncated,
        summary: summarizeArchive(inWindow),
        unavailable,
        connections: connections.map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
        nodes: nodeOptions,
      },
    })
  } catch (error: any) {
    console.error('API task archive error:', error)

    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}
