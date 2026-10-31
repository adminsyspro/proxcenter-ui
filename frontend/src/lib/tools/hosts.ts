/**
 * Host maintenance and resilience: pending updates, subscriptions,
 * certificates, HA and quorum, CVE exposure (#459).
 *
 * These read Proxmox (or, for CVEs, the orchestrator's scanner, which reaches
 * every host over SSH), so each one is bounded the same way as the history:
 * hosts and clusters come from the RBAC- and vDC-filtered snapshot, results
 * are cached per tenant and target, an in-flight read is shared, and the
 * fan-out runs at the inventory's pveproxy concurrency.
 */

import { hasServerFeature } from '@/lib/auth/requireEnterprise'
import { getConnectionById } from '@/lib/connections/getConnection'
import { mapWithConcurrency } from '@/lib/inventory/concurrency'
import { Features } from '@/lib/license/features'
import { orchestratorFetch, orchestratorPath } from '@/lib/orchestrator/client'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

import type { SnapshotNode } from './snapshot'
import { argString, resolveConnection, resolveNode, ToolScopeError, type CatalogTool, type ToolContext } from './types'

/* ------------------------------------------------------------------ */
/* Shared cache                                                       */
/* ------------------------------------------------------------------ */

const cache = new Map<string, { at: number; value: Promise<unknown> }>()
const CACHE_MAX_ENTRIES = 300

/** Test hook: the cache is module state. */
export function clearHostsCache() {
  cache.clear()
}

function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)

  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>

  const value = load()

  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value

    if (oldest !== undefined) cache.delete(oldest)
  }

  cache.set(key, { at: Date.now(), value })
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key)
  })

  return value
}

function day(epochSeconds: number | null, timeZone: string | undefined) {
  if (!epochSeconds) return null

  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(epochSeconds * 1000)
    )
  } catch {
    return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
  }
}

/** The hosts a call is about: one named host, one cluster, or every visible one. */
function targetNodes(args: Record<string, unknown>, ctx: ToolContext): SnapshotNode[] {
  const nodeRef = argString(args, 'node')
  const clusterRef = argString(args, 'cluster')

  if (nodeRef) return [resolveNode(ctx, nodeRef, clusterRef).node]

  const connId = clusterRef ? resolveConnection(ctx, clusterRef).id : null

  return ctx.snapshot.nodes.filter(n => !connId || n.connId === connId)
}

async function requireNodeView(connIds: string[]) {
  const refusals = await Promise.all([...new Set(connIds)].map(id => checkPermission(PERMISSIONS.NODE_VIEW, 'connection', id)))

  if (refusals.some(Boolean)) {
    throw new ToolScopeError('You do not have the permission to view host details on this cluster.')
  }
}

/* ------------------------------------------------------------------ */
/* get_host_maintenance                                               */
/* ------------------------------------------------------------------ */

/** Pending updates move once a night (pveupdate), subscriptions and certificates even less. */
export const HOST_MAINTENANCE_TTL_MS = 15 * 60_000

/**
 * The pending update list of one host, through the very cache entry
 * get_host_maintenance fills (same key), so a remediation plan
 * (roadmap#188) asked right after that tool costs no Proxmox call.
 */
export function readPendingUpdates(ctx: ToolContext, node: SnapshotNode): Promise<any[]> {
  const path = `/nodes/${encodeURIComponent(node.name)}/apt/update`

  return cached<any[]>(`${ctx.tenantId}|${node.connId}|${path}`, HOST_MAINTENANCE_TTL_MS, async () =>
    pveFetch<any[]>(await getConnectionById(node.connId, ctx.tenantId), path)
  ).then(list => (Array.isArray(list) ? list : []))
}

/** Hosts read per call: past it the model narrows to a cluster or a host. */
export const MAX_MAINTENANCE_HOSTS = 12

const HOST_READ_CONCURRENCY = 4

const isSecurity = (u: any) => /security/i.test(`${u?.Origin ?? ''} ${u?.Section ?? ''} ${u?.Priority ?? ''}`)

const CERT_SOON_DAYS = 30

export const getHostMaintenanceTool: CatalogTool = {
  name: 'get_host_maintenance',
  readOnly: true,
  description:
    'Maintenance state of the Proxmox hosts: pending package updates (security ones counted apart, Proxmox VE packages named), subscription status, and certificate expiry. Answers "which hosts have pending updates?", "are there security updates?", "is the subscription valid?", "does a certificate expire soon?". Example: (no argument) or node=\'pve1\'',
  parameters: {
    type: 'object',
    properties: {
      cluster: { type: 'string', description: 'Cluster name, only when the user names one.' },
      node: { type: 'string', description: 'Host name, for one host.' },
    },
  },
  async execute(args, ctx) {
    const nodes = targetNodes(args, ctx).filter(n => n.status === 'online')

    if (nodes.length > MAX_MAINTENANCE_HOSTS) {
      throw new ToolScopeError(`That is ${nodes.length} hosts; at most ${MAX_MAINTENANCE_HOSTS} are read at once. Name a cluster or a host.`)
    }

    await requireNodeView(nodes.map(n => n.connId))

    const now = Date.now() / 1000

    // Every read lands on the one pveproxy of the connection: a few at a time.
    const hosts = await mapWithConcurrency(nodes, HOST_READ_CONCURRENCY, async node => {
      const base = `/nodes/${encodeURIComponent(node.name)}`

      // Three GETs per host, all reading what Proxmox already holds: the
      // update list `pveupdate` refreshed overnight (no apt run), the
      // subscription and the certificate files.
      const read = <T>(path: string) =>
        cached<T>(`${ctx.tenantId}|${node.connId}|${path}`, HOST_MAINTENANCE_TTL_MS, async () =>
          pveFetch<T>(await getConnectionById(node.connId, ctx.tenantId), path)
        )

      const [updates, subscription, certificates] = await Promise.allSettled([
        read<any[]>(`${base}/apt/update`),
        read<any>(`${base}/subscription`),
        read<any[]>(`${base}/certificates/info`),
      ])

      const list = updates.status === 'fulfilled' && Array.isArray(updates.value) ? updates.value : null
      const sub = subscription.status === 'fulfilled' ? subscription.value : null
      const certs = certificates.status === 'fulfilled' && Array.isArray(certificates.value) ? certificates.value : []
      const soonest = certs
        .map(c => (typeof c?.notafter === 'number' ? c.notafter : null))
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b)[0] ?? null

      return {
        host: node.name,
        cluster: node.cluster,
        pveVersion: node.pveVersion ?? null,
        updates: list
          ? {
              pending: list.length,
              security: list.filter(isSecurity).length,
              proxmoxPackages: list.filter(u => /^(pve-|proxmox-|qemu-server|pve-manager)/.test(String(u?.Package ?? ''))).map(u => `${u.Package} ${u.OldVersion ?? ''} -> ${u.Version ?? ''}`.trim()).slice(0, 8),
            }
          : { unavailable: true },
        subscription: sub ? { status: sub.status ?? null, level: sub.level ?? null, nextDueDate: sub.nextduedate ?? null } : { unavailable: true },
        certificateExpires: day(soonest, ctx.timeZone),
        certificateExpiresInDays: soonest ? Math.floor((soonest - now) / 86_400) : null,
        certificateExpiresSoon: soonest ? soonest - now < CERT_SOON_DAYS * 86_400 : null,
      }
    })

    return {
      hosts,
      hostsWithUpdates: hosts.filter(h => (h.updates as any).pending > 0).length,
      hostsWithSecurityUpdates: hosts.filter(h => (h.updates as any).security > 0).length,
      note: 'Pending updates are the list Proxmox refreshes nightly; installing them is up to the user.',
    }
  },
}

/* ------------------------------------------------------------------ */
/* get_ha_status                                                      */
/* ------------------------------------------------------------------ */

export const HA_STATUS_TTL_MS = 30_000

export const getHaStatusTool: CatalogTool = {
  name: 'get_ha_status',
  readOnly: true,
  description:
    'Proxmox HA and quorum per cluster: whether the cluster is quorate, which host is HA master, the state of each host HA agent, and the HA-managed guests in error, fenced or not where they should be. Answers "is my cluster quorate?", "are HA resources healthy?", "why is db-01 in HA error?". Example: (no argument) or cluster=\'PVE-PROD\'',
  parameters: {
    type: 'object',
    properties: { cluster: { type: 'string', description: 'Cluster name, only when the user names one.' } },
  },
  async execute(args, ctx) {
    const clusterRef = argString(args, 'cluster')
    const connections = clusterRef ? [resolveConnection(ctx, clusterRef)] : ctx.snapshot.clusters.map(c => ({ id: c.id, name: c.name }))

    const clusters = await Promise.all(
      connections.map(async c => {
        let rows: any[]

        try {
          // One call per cluster: quorum, master, agents and services in one list.
          rows = await cached<any[]>(`${ctx.tenantId}|${c.id}|ha`, HA_STATUS_TTL_MS, async () => {
            const list = await pveFetch<any[]>(await getConnectionById(c.id, ctx.tenantId), '/cluster/ha/status/current')

            return Array.isArray(list) ? list : []
          })
        } catch {
          return { cluster: c.name, available: false }
        }

        const visibleNode = (name: unknown) => ctx.snapshot.nodes.some(n => n.connId === c.id && n.name === name)
        const visibleGuest = (sid: unknown) => {
          const vmid = typeof sid === 'string' ? sid.split(':')[1] : undefined

          return Boolean(vmid) && ctx.snapshot.guests.some(g => g.connId === c.id && g.vmid === vmid)
        }

        const quorum = rows.find(r => r?.id === 'quorum')
        const master = rows.find(r => r?.type === 'master' || r?.id === 'master')
        const services = rows.filter(r => r?.type === 'service' && visibleGuest(r.sid))
        const unhealthy = services.filter(s => !['started', 'stopped', 'ignored', 'disabled'].includes(String(s.state)))

        return {
          cluster: c.name,
          quorate: quorum ? Boolean(quorum.quorate) || quorum.status === 'OK' : null,
          quorumStatus: quorum?.status ?? null,
          master: master && visibleNode(master.node) ? master.node : null,
          agents: rows
            .filter(r => r?.type === 'lrm' && visibleNode(r.node))
            .map(r => ({ host: r.node, status: typeof r.status === 'string' ? r.status.slice(0, 80) : null })),
          managedGuests: services.length,
          guestsNeedingAttention: unhealthy.slice(0, 20).map(s => ({
            guest: ctx.snapshot.guests.find(g => g.connId === c.id && g.vmid === String(s.sid).split(':')[1])?.name ?? s.sid,
            state: s.state,
            host: visibleNode(s.node) ? s.node : null,
          })),
        }
      })
    )

    return { clusters }
  },
}

/* ------------------------------------------------------------------ */
/* get_cve_exposure                                                   */
/* ------------------------------------------------------------------ */

/**
 * A CVE read is a scan: the orchestrator connects to every host over SSH and
 * compares its packages with the Debian tracker. Kept six hours, one cluster
 * per call and one scan per question.
 */
export const CVE_TTL_MS = 6 * 3_600_000

export const MAX_CVE_SCANS_PER_QUESTION = 1

/** Under nginx's 60 s read timeout, which a silent tool round would hit. */
const CVE_TIMEOUT_MS = 40_000

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'unknown']

export const getCveExposureTool: CatalogTool = {
  name: 'get_cve_exposure',
  readOnly: true,
  description:
    'Known vulnerabilities (CVE) of the packages installed on the hosts of ONE cluster: count per severity and per host, how many have a fix available, and the most severe ones with the package and the fixed version. Answers "are my hosts exposed to critical CVEs?", "which host has the most vulnerabilities?". Example: cluster=\'PVE-PROD\'',
  parameters: {
    type: 'object',
    properties: {
      cluster: { type: 'string', description: 'Cluster name. Omit only when a single cluster is visible.' },
    },
  },
  async execute(args, ctx) {
    if (!(await hasServerFeature(Features.CVE_SCANNER))) {
      throw new ToolScopeError('The CVE scanner is not part of this ProxCenter licence.')
    }

    const connection = resolveConnection(ctx, argString(args, 'cluster'))

    await requireNodeView([connection.id])

    const key = `${ctx.tenantId}|${connection.id}|cve`
    const fresh = cache.get(key)
    const isCached = Boolean(fresh && Date.now() - fresh.at < CVE_TTL_MS)
    const usage = (ctx.usage ??= { historyLookups: 0 })

    if (!isCached) {
      const scans = usage.cveScans ?? 0

      if (scans >= MAX_CVE_SCANS_PER_QUESTION) {
        throw new ToolScopeError('One CVE scan per question: answer with the cluster already scanned, or ask again about the other one.')
      }

      usage.cveScans = scans + 1
    }

    let result: any

    try {
      result = await cached(key, CVE_TTL_MS, () =>
        orchestratorFetch<any>(orchestratorPath`/cve/${connection.id}`, { timeout: CVE_TIMEOUT_MS })
      )
    } catch {
      return { cluster: connection.name, available: false, reason: 'The CVE scan did not answer in time. The CVE page shows the full scan.' }
    }

    const visibleHost = (node: unknown) => ctx.snapshot.nodes.some(n => n.connId === connection.id && n.name === node)
    const vulns: any[] = (Array.isArray(result?.vulnerabilities) ? result.vulnerabilities : []).filter((v: any) => visibleHost(v?.node))
    const bySeverity = Object.fromEntries(SEVERITY_ORDER.map(s => [s, vulns.filter(v => String(v.severity).toLowerCase() === s).length]))

    return {
      cluster: connection.name,
      scannedAt: result?.lastScan ? new Date(result.lastScan).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null,
      total: vulns.length,
      fixable: vulns.filter(v => v.fixAvailable).length,
      bySeverity,
      perHost: (Array.isArray(result?.nodes) ? result.nodes : [])
        .filter((n: any) => visibleHost(n?.node))
        .map((n: any) => ({
          host: n.node,
          total: vulns.filter(v => v.node === n.node).length,
          critical: vulns.filter(v => v.node === n.node && String(v.severity).toLowerCase() === 'critical').length,
          ...(n.error ? { error: String(n.error).slice(0, 120) } : {}),
        })),
      mostSevere: [...vulns]
        .sort((a, b) => SEVERITY_ORDER.indexOf(String(a.severity).toLowerCase()) - SEVERITY_ORDER.indexOf(String(b.severity).toLowerCase()))
        .slice(0, 10)
        .map(v => ({ cve: v.cveId, severity: v.severity, host: v.node, package: v.package, installed: v.installedVersion, fixedIn: v.fixedVersion || null })),
    }
  },
}
