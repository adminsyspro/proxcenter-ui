import { prisma } from '@/lib/db/prisma'
import { getOrchestratorClient, orchestratorFetch, orchestratorPath } from '@/lib/orchestrator/client'
import { connectionUsers } from '@/lib/orchestrator/replicationScope'
import { TERMINAL_STATUSES } from '@/lib/tasks/sharedTask'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/constants'

import { BLOCKING_KINDS, type ConnectionUsage, type UsageKind } from './connectionUsageKinds'

/**
 * What still uses a connection, read before it is deleted (ui#1394).
 *
 * Deleting a connection left whatever named it by id behind: Site Recovery
 * jobs counted on the dashboard yet hidden everywhere, a vDC that made the
 * deletion fail with a raw foreign-key error, a PBS a tenant backed up to
 * silently unbound. Each blocking kind is a live link the operator removes
 * first, from its own screen. What the database deletes with the connection
 * (storage policies, SDN zones, Green settings) and history are not listed.
 *
 * What only the orchestrator knows is skipped when it cannot answer
 * (Community edition, or down): its absence must not lock the connection.
 */

export { BLOCKING_KINDS, isBlocked } from './connectionUsageKinds'
export type { ConnectionUsage, UsageKind } from './connectionUsageKinds'

const ACTIVE_VDC_MOVE_STATUSES = ['queued', 'copying', 'finalizing']

/** The orchestrator's answer, or null when it cannot give one. */
async function fromOrchestrator<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

async function tenantNames(ids: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)].filter(id => id && id !== DEFAULT_TENANT_ID)
  if (wanted.length === 0) return new Map()
  const rows = await prisma.tenant.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } })

  return new Map(rows.map(t => [t.id, t.name]))
}

const withTenant = (name: string, tenantId: string, tenants: Map<string, string>) =>
  tenants.has(tenantId) ? `${name} (${tenants.get(tenantId)})` : name

async function vdcsOn(connectionId: string): Promise<string[]> {
  const vdcs = await prisma.vdc.findMany({ where: { connectionId }, select: { name: true, tenantId: true }, orderBy: { name: 'asc' } })
  const tenants = await tenantNames(vdcs.map(v => v.tenantId))

  return vdcs.map(v => withTenant(v.name, v.tenantId, tenants))
}

async function vdcsBackingUpTo(pbsConnectionId: string): Promise<string[]> {
  const bindings = await prisma.vdcPbsNamespace.findMany({
    where: { pbsConnectionId },
    select: { vdc: { select: { name: true, tenantId: true } } },
  })
  const tenants = await tenantNames(bindings.map(b => b.vdc.tenantId))

  return [...new Set(bindings.map(b => withTenant(b.vdc.name, b.vdc.tenantId, tenants)))]
}

async function tenantOwner(conn: { tenantId: string }, callerTenantId: string): Promise<string[]> {
  if (!conn.tenantId || conn.tenantId === DEFAULT_TENANT_ID || conn.tenantId === callerTenantId) return []
  const tenants = await tenantNames([conn.tenantId])

  return [tenants.get(conn.tenantId) || conn.tenantId]
}

async function runningMigrations(connectionId: string): Promise<string[]> {
  const jobs = await prisma.migrationJob.findMany({
    where: {
      OR: [{ sourceConnectionId: connectionId }, { targetConnectionId: connectionId }],
      status: { notIn: [...TERMINAL_STATUSES] },
    },
    select: { sourceVmName: true, sourceVmId: true },
  })

  return jobs.map(j => j.sourceVmName || j.sourceVmId)
}

async function runningVdcMoves(connectionId: string): Promise<string[]> {
  const moves = await prisma.vdcMove.findMany({
    where: {
      OR: [{ sourceConnectionId: connectionId }, { targetConnectionId: connectionId }],
      status: { in: ACTIVE_VDC_MOVE_STATUSES },
    },
    select: { guestName: true, vmid: true },
  })

  return moves.map(m => m.guestName || String(m.vmid))
}

async function complianceProfiles(connectionId: string): Promise<string[]> {
  const rows = await prisma.complianceProfile.findMany({ where: { connectionId }, select: { name: true } })

  return rows.map(r => r.name)
}

/** Windows still to come or under way: past ones are history. */
async function slaWindows(connectionId: string): Promise<string[]> {
  const rows = await prisma.slaMaintenanceWindow.findMany({
    where: { connectionId, endsAt: { gt: new Date() } },
    select: { reason: true, startsAt: true },
    orderBy: { startsAt: 'asc' },
  })

  return rows.map(r => `${r.reason} (${r.startsAt.toISOString().slice(0, 10)})`)
}

async function apiTokensLimitedTo(connectionId: string): Promise<string[]> {
  const rows = await prisma.apiToken.findMany({
    where: {
      connectionIds: { array_contains: [connectionId] },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { name: true },
  })

  return rows.map(r => r.name)
}

async function siteRecovery(connectionId: string): Promise<{ jobs: string[]; plans: string[] }> {
  const client = getOrchestratorClient()
  const [jobs, plans] = await Promise.all([
    fromOrchestrator(() => client.getReplicationJobs()),
    fromOrchestrator(() => client.getRecoveryPlans()),
  ])

  return connectionUsers(connectionId, { jobs: jobs?.data, plans: plans?.data })
}

/**
 * The DRS affinity rules written for the cluster, read from the orchestrator's
 * table in the shared database, as host-key-store reads ssh_known_hosts: its
 * GET /rules also derives tag rules by listing the guests of every cluster, a
 * Proxmox fan-out each time the dialog opens. Tag rules leave with the
 * cluster anyway. No table (Community edition): nothing to list.
 */
async function drsRules(connectionId: string): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<{ id: string; name: string | null }[]>`
      SELECT id, name FROM affinity_rule_records WHERE connection_id = ${connectionId} ORDER BY name`

    return rows.map(r => r.name || r.id)
  } catch {
    return []
  }
}

async function restoreDrillSchedules(connectionId: string): Promise<string[]> {
  const page = await fromOrchestrator(() => getOrchestratorClient().listRestoreDrillSchedules(200, 0))

  return (page?.data?.data || []).filter(s => s.connection_id === connectionId).map(s => s.name || s.id)
}

/**
 * A micro-segmentation policy blocks when it is applied on this cluster (its
 * rules must be removed first) or shared with other clusters (this one must be
 * dissociated first). One left inactive on this cluster alone does not: the
 * last cluster of a policy cannot leave it, so blocking would lock the
 * connection for good.
 */
async function microsegPolicy(connectionId: string): Promise<string[]> {
  type Link = { policy_id: string; connection_id: string; active: boolean }
  const res = await fromOrchestrator(() =>
    orchestratorFetch<{ clusters?: Link[] }>(orchestratorPath`/microseg/${connectionId}/clusters`, { timeout: 10000 })
  )
  const links = (res?.clusters || []).filter(l => l.policy_id)
  const own = links.find(l => l.connection_id === connectionId)

  if (!own || (!own.active && links.length < 2)) return []
  const names = new Map(
    (await prisma.connection.findMany({ where: { id: { in: links.map(l => l.connection_id) } }, select: { id: true, name: true } }))
      .map(c => [c.id, c.name])
  )

  return links.map(l => names.get(l.connection_id) || l.connection_id)
}

/**
 * The nodes that still hold a firewall log forwarder of the cluster
 * (micro-segmentation, forwarder mode), installed or left by a removal that
 * failed. They are removed over the SSH access of the connection, so they
 * must go first: put the collection back in API mode, or retry the node.
 * Read from the orchestrator's table in the shared database, as drsRules
 * does. No table (Community edition, older orchestrator): nothing to list.
 */
async function logForwarders(connectionId: string): Promise<string[]> {
  try {
    const rows = await prisma.$queryRaw<{ node: string | null }[]>`
      SELECT node FROM logfwd_nodes WHERE connection_id = ${connectionId} ORDER BY node`

    return rows.map(r => r.node).filter((n): n is string => typeof n === 'string' && n !== '')
  } catch {
    return []
  }
}

const none = async (): Promise<string[]> => []

export async function connectionUsage(
  connectionId: string,
  conn: { type: string; tenantId: string },
  { callerTenantId }: { callerTenantId: string }
): Promise<ConnectionUsage> {
  const isPve = conn.type === 'pve'
  const [owner, vdcs, pbsVdcs, sr, microseg, rules, migrations, vdcMoves, profiles, windows, drills, forwarders, apiTokens] = await Promise.all([
    tenantOwner(conn, callerTenantId),
    isPve ? vdcsOn(connectionId) : none(),
    conn.type === 'pbs' ? vdcsBackingUpTo(connectionId) : none(),
    isPve ? siteRecovery(connectionId) : Promise.resolve({ jobs: [], plans: [] }),
    isPve ? microsegPolicy(connectionId) : none(),
    isPve ? drsRules(connectionId) : none(),
    runningMigrations(connectionId),
    isPve ? runningVdcMoves(connectionId) : none(),
    complianceProfiles(connectionId),
    slaWindows(connectionId),
    restoreDrillSchedules(connectionId),
    isPve ? logForwarders(connectionId) : none(),
    apiTokensLimitedTo(connectionId),
  ])

  const found: Record<UsageKind, string[]> = {
    tenantOwner: owner,
    vdcs,
    pbsVdcs,
    replicationJobs: sr.jobs,
    recoveryPlans: sr.plans,
    microseg,
    drsRules: rules,
    migrations,
    vdcMoves,
    complianceProfiles: profiles,
    slaWindows: windows,
    restoreDrillSchedules: drills,
    logForwarders: forwarders,
  }
  const blocking: ConnectionUsage['blocking'] = {}
  for (const kind of BLOCKING_KINDS) if (found[kind].length > 0) blocking[kind] = found[kind]

  return { blocking, apiTokens }
}
