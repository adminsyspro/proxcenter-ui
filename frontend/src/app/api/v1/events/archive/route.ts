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
  type ArchiveQuery,
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

interface ConnectionRead {
  tasks: ArchiveTask[]
  nodes: { connectionId: string; node: string; status: string }[]
  unavailable: { connectionName: string; node: string }[]
  truncated: boolean
}

interface ReadContext {
  query: ArchiveQuery
  nowSec: number
  rbacScope: RbacInfraScope | null
  vdcScope: ReturnType<typeof maskingScope>
  vdcVmids: Map<string, Set<string>> | null
}

async function readGuests(connection: any): Promise<Map<string, GuestInfo>> {
  const resources = await pveFetch<any[]>(connection, '/cluster/resources?type=vm').catch(() => [])
  const guests = new Map<string, GuestInfo>()

  for (const r of Array.isArray(resources) ? resources : []) {
    if (r.vmid == null) continue
    guests.set(String(r.vmid), { name: r.name || null, type: guestKind(r.type), status: r.status || null })
  }

  return guests
}

/** The archive of one connection: every readable node of it, scoped and filtered. */
async function readConnectionArchive(conn: { id: string; name: string; tenantId: string | null }, ctx: ReadContext): Promise<ConnectionRead> {
  const { query, nowSec, rbacScope } = ctx
  const out: ConnectionRead = { tasks: [], nodes: [], unavailable: [], truncated: false }
  const connection = await getConnectionById(conn.id, conn.tenantId ?? undefined)
  const allowedNodes = ctx.vdcScope?.nodesByConnection.get(conn.id)

  const [nodes, guests] = await Promise.all([
    pveFetch<{ node: string; status?: string }[]>(connection, '/nodes'),
    readGuests(connection),
  ])

  const readableNodes = (Array.isArray(nodes) ? nodes : []).filter(n => !allowedNodes || allowedNodes.has(n.node))
  const nodeStatus = new Map(readableNodes.map(n => [n.node, n.status || 'unknown']))

  for (const n of readableNodes) {
    if (isFlatRecordVisible(rbacScope, { connId: conn.id, node: n.node })) {
      out.nodes.push({ connectionId: conn.id, node: n.node, status: n.status || 'unknown' })
    }
  }

  const params = new URLSearchParams({
    source: 'all',
    since: String(query.since),
    until: String(query.until),
    limit: String(ARCHIVE_NODE_LIMIT),
  })
  if (query.vmid) params.set('vmid', query.vmid)

  // An offline or failing node cannot serve its archive: say so instead of
  // returning a silently shorter history.
  const markUnavailable = (node: string) => {
    if (nodeInTree(rbacScope, conn.id, node)) out.unavailable.push({ connectionName: conn.name, node })
  }

  await Promise.all(
    readableNodes
      .filter(n => !query.node || n.node === query.node)
      .map(async n => {
        if (n.status && n.status !== 'online') return markUnavailable(n.node)
        try {
          const entries = await pveFetch<PveTaskEntry[]>(
            connection,
            `/nodes/${encodeURIComponent(n.node)}/tasks?${params}`,
            {},
            { timeoutMs: NODE_TIMEOUT_MS },
          )
          if (!Array.isArray(entries)) return
          if (entries.length >= ARCHIVE_NODE_LIMIT) out.truncated = true

          const scoped = scopeConnectionTasks(entries, {
            connId: conn.id,
            allowedNodes,
            allowedVmids: ctx.vdcVmids?.get(conn.id),
            rbacScope,
          })
          for (const entry of scoped) {
            const task = toArchiveTask(entry, { connectionId: conn.id, connectionName: conn.name, nowSec, guests, nodeStatus })
            // Status is filtered after the summary, so its counters keep
            // showing every status of the window.
            if (matchesArchiveFilters(task, { ...query, status: 'all' })) out.tasks.push(task)
          }
        } catch (e) {
          console.error(`Task archive error for ${conn.name}/${n.node}:`, e)
          markUnavailable(n.node)
        }
      }),
  )

  return out
}

/**
 * Attach the ProxCenter user behind each task of the page (roadmap#41), same
 * rule as the live feed: without admin.audit, one's own actions only.
 */
async function attachInitiators(rows: ArchiveTask[], tenantId: string | null): Promise<void> {
  if (rows.length === 0) return
  try {
    const oldest = Math.min(...rows.map(r => new Date(r.ts).getTime()))
    const readsJournal = !(await checkPermission(PERMISSIONS.ADMIN_AUDIT))
    const self = readsJournal ? null : (await getPrincipal()).principal
    const onlyFor = readsJournal ? undefined : { userId: self?.userId, apiTokenId: self?.tokenId }
    const initiators = await findTaskInitiators(rows.map(r => r.id), { tenantId, since: new Date(oldest - 60_000), onlyFor })

    for (const row of rows) {
      const initiator = initiators.get(row.id)
      if (initiator) row.initiatedBy = initiator
    }
  } catch (e) {
    console.error('Task archive attribution error:', e)
  }
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

    const ctx: ReadContext = { query, nowSec, rbacScope, vdcScope, vdcVmids }
    const reads = await Promise.all(
      connections
        .filter(conn => !query.connectionId || conn.id === query.connectionId)
        .map(conn =>
          readConnectionArchive(conn, ctx).catch((e): ConnectionRead => {
            console.error(`Task archive connection error ${conn.name}:`, e)

            return { tasks: [], nodes: [], unavailable: [{ connectionName: conn.name, node: '' }], truncated: false }
          }),
        ),
    )

    const inWindow = mergeArchiveTasks(reads.flatMap(r => r.tasks))
    const merged = query.status === 'all' ? inWindow : inWindow.filter(t => t.statusClass === query.status)
    const lastPage = Math.max(0, Math.ceil(merged.length / query.pageSize) - 1)
    const page = Math.min(query.page, lastPage)
    const rows = merged.slice(page * query.pageSize, (page + 1) * query.pageSize)

    await attachInitiators(rows, infra.kind === 'provider' ? null : tenantId)

    const nodeOptions = reads.flatMap(r => r.nodes).sort((a, b) => a.node.localeCompare(b.node))
    const unavailable = reads
      .flatMap(r => r.unavailable)
      .sort((a, b) => a.connectionName.localeCompare(b.connectionName) || a.node.localeCompare(b.node))

    return NextResponse.json({
      data: rows,
      meta: {
        total: merged.length,
        page,
        pageSize: query.pageSize,
        since: query.since,
        until: query.until,
        truncated: reads.some(r => r.truncated),
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
