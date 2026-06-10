// src/lib/diagnostics/connectionDiagnostics.ts
//
// Read-only diagnostic runner for connections.
// Executes health checks against PVE/PBS APIs (GET only) and returns a
// structured report. No side effects, no mutations.

import net from 'net'

import { pveFetch, type ProxmoxClientOptions } from "@/lib/proxmox/client"
import { pbsFetch, type PbsClientOptions } from "@/lib/proxmox/pbs-client"

export type DiagnosticStatus = 'ok' | 'warn' | 'error' | 'skip'

export interface DiagnosticCheck {
  id: string
  category: 'network' | 'auth' | 'version' | 'cluster' | 'storage' | 'ssh' | 'datastore'
  label: string
  status: DiagnosticStatus
  message: string
  detail?: string
  durationMs: number
}

export interface DiagnosticReport {
  connectionId: string
  type: string
  checks: DiagnosticCheck[]
  summary: { ok: number; warn: number; error: number; skip: number }
  ranAt: string
  durationMs: number
}

/**
 * Metadata passed alongside the loaded client config so the runner
 * can branch on connection properties without re-loading from the DB.
 */
export interface DiagnosticMeta {
  connectionId: string
  type: string
  hasCeph?: boolean
  sshEnabled?: boolean
  /** Resolved node IP for SSH checks (optional; skip SSH check when absent). */
  sshHost?: string
  /** SSH port (default 22). */
  sshPort?: number
  /** SSH user (default root). */
  sshUser?: string
  /** SSH private key (decrypted). */
  sshKey?: string
  /** SSH password (decrypted). */
  sshPassword?: string
  /** SSH passphrase for private key (decrypted). */
  sshPassphrase?: string
  /** Base URL of the external connection (e.g. https://vcenter.example.com). */
  baseUrl?: string
  /**
   * Whether the calling user holds the connection.manage permission.
   * The SSH check mutates the trust store (host-key TOFU pinning), so it is
   * gated behind manage. View-only callers receive a skip result instead.
   */
  canManage?: boolean
}

// ---------------------------------------------------------------------------
// TCP reachability helper
// ---------------------------------------------------------------------------

/**
 * Attempts a raw TCP connection to host:port and resolves when the connection
 * is established, or rejects on timeout or error. Exported so tests can spy.
 */
export function tcpReachable(host: string, port: number, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port })
    const done = (err?: Error) => { sock.destroy(); err ? reject(err) : resolve() }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done())
    sock.once('timeout', () => done(new Error(`timed out connecting to ${host}:${port}`)))
    sock.once('error', (e) => done(e))
  })
}

// ---------------------------------------------------------------------------
// Internal runner helpers
// ---------------------------------------------------------------------------

/**
 * Wraps a diagnostic fn with a timeout and top-level catch so a single
 * failing check never throws out of the runner.
 */
export async function runCheck(
  id: string,
  category: DiagnosticCheck['category'],
  label: string,
  fn: () => Promise<{ status: DiagnosticStatus; message: string; detail?: string }>,
  timeoutMs = 10000,
): Promise<DiagnosticCheck> {
  const start = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const res = await Promise.race([
      fn(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
    return { id, category, label, ...res, durationMs: Date.now() - start }
  } catch (e: any) {
    return {
      id,
      category,
      label,
      status: 'error',
      message: e?.message || String(e),
      durationMs: Date.now() - start,
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function buildSummary(checks: DiagnosticCheck[]) {
  return checks.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1
      return acc
    },
    { ok: 0, warn: 0, error: 0, skip: 0 } as DiagnosticReport['summary'],
  )
}

// ---------------------------------------------------------------------------
// PVE checks
// ---------------------------------------------------------------------------

async function pveNetworkAndVersion(conn: ProxmoxClientOptions): Promise<DiagnosticCheck> {
  return runCheck('pve.network', 'network', 'API reachability and version', async () => {
    const data = await pveFetch<any>(conn, '/version')
    const version: string = data?.version ?? 'unknown'
    // Warn if we can detect an outdated major version (PVE 6 or earlier).
    const major = parseInt(version.split('.')[0] ?? '0', 10)
    if (major > 0 && major < 7) {
      return {
        status: 'warn',
        message: `Connected to PVE ${version}`,
        detail: 'PVE 7+ is recommended for full ProxCenter support.',
      }
    }
    return { status: 'ok', message: `Connected to PVE ${version}` }
  })
}

async function pveAuth(conn: ProxmoxClientOptions): Promise<DiagnosticCheck> {
  return runCheck('pve.auth', 'auth', 'API token permissions', async () => {
    // Probing /access/permissions verifies the token has permission to read
    // access data. We also probe /cluster/resources as a secondary signal.
    const failedPaths: string[] = []

    await pveFetch<any>(conn, '/access/permissions').catch(() => {
      failedPaths.push('/access/permissions')
    })
    await pveFetch<any>(conn, '/cluster/resources').catch(() => {
      failedPaths.push('/cluster/resources')
    })

    if (failedPaths.length === 0) {
      return { status: 'ok', message: 'Token has read access to cluster APIs.' }
    }
    if (failedPaths.length === 2) {
      return {
        status: 'error',
        message: 'Token lacks read access.',
        detail: `Failed paths: ${failedPaths.join(', ')}`,
      }
    }
    return {
      status: 'warn',
      message: 'Token has partial read access.',
      detail: `Could not read: ${failedPaths.join(', ')}`,
    }
  })
}

async function pveCluster(conn: ProxmoxClientOptions, hasCeph: boolean): Promise<DiagnosticCheck[]> {
  const clusterCheck = await runCheck('pve.cluster', 'cluster', 'Cluster quorum and node health', async () => {
    const status = await pveFetch<any[]>(conn, '/cluster/status')
    const clusterEntry = (status || []).find((e: any) => e.type === 'cluster')
    const nodeEntries = (status || []).filter((e: any) => e.type === 'node')

    const total = nodeEntries.length
    const online = nodeEntries.filter((n: any) => n.online === 1 || n.online === true).length

    if (!clusterEntry) {
      // Standalone node (not in a named cluster)
      return { status: 'ok', message: 'Standalone node (no cluster)', detail: `${total} node(s)` }
    }

    const quorate = clusterEntry.quorate === 1 || clusterEntry.quorate === true
    const clusterName: string = clusterEntry.name ?? ''

    if (!quorate) {
      return {
        status: 'error',
        message: `Cluster "${clusterName}" has lost quorum.`,
        detail: `${online}/${total} nodes online.`,
      }
    }
    if (online < total) {
      return {
        status: 'warn',
        message: `Cluster "${clusterName}" quorate but ${total - online} node(s) offline.`,
        detail: `${online}/${total} nodes online.`,
      }
    }
    return {
      status: 'ok',
      message: `Cluster "${clusterName}" is quorate.`,
      detail: `${online}/${total} nodes online.`,
    }
  })

  const checks: DiagnosticCheck[] = [clusterCheck]

  if (hasCeph) {
    const cephCheck = await runCheck('pve.ceph', 'cluster', 'Ceph health', async () => {
      const data = await pveFetch<any>(conn, '/cluster/ceph/status')
      const healthStatus: string = data?.health?.status ?? ''
      if (healthStatus === 'HEALTH_OK') {
        return { status: 'ok', message: 'Ceph health is OK.' }
      }
      if (healthStatus === 'HEALTH_WARN') {
        const checks = Object.values(data?.health?.checks ?? {}) as any[]
        const msgs = checks.map((c: any) => c?.summary?.message ?? c?.message ?? '').filter(Boolean)
        return {
          status: 'warn',
          message: 'Ceph health warning.',
          detail: msgs.length > 0 ? msgs.join('; ') : undefined,
        }
      }
      if (healthStatus === 'HEALTH_ERR') {
        return { status: 'error', message: 'Ceph health error.', detail: healthStatus }
      }
      // Unexpected or empty status
      return { status: 'warn', message: `Ceph health status: "${healthStatus || 'unknown'}"` }
    })
    checks.push(cephCheck)
  }

  return checks
}

async function pveStorage(conn: ProxmoxClientOptions): Promise<DiagnosticCheck> {
  return runCheck('pve.storage', 'storage', 'Cluster storage health', async () => {
    const resources = await pveFetch<any[]>(conn, '/cluster/resources?type=storage')
    const storages = resources ?? []

    const inactive: string[] = []
    const warnHigh: string[] = []
    const errFull: string[] = []

    for (const s of storages) {
      const name: string = s.storage ?? s.id ?? '?'
      const active = s.status === 'active' || s.status === 'available' || !s.status
      if (!active) {
        inactive.push(name)
        continue
      }
      if (s.maxdisk && s.maxdisk > 0 && s.disk != null) {
        const pct = s.disk / s.maxdisk
        if (pct > 0.95) errFull.push(`${name} (${Math.round(pct * 100)}%)`)
        else if (pct > 0.85) warnHigh.push(`${name} (${Math.round(pct * 100)}%)`)
      }
    }

    const total = storages.length

    if (errFull.length > 0) {
      return {
        status: 'error',
        message: `${errFull.length} storage(s) critically full (>95%).`,
        detail: `Full: ${errFull.join(', ')}. Total storages: ${total}.`,
      }
    }
    if (inactive.length > 0 || warnHigh.length > 0) {
      const parts: string[] = []
      if (inactive.length > 0) parts.push(`Inactive: ${inactive.join(', ')}`)
      if (warnHigh.length > 0) parts.push(`High usage (>85%): ${warnHigh.join(', ')}`)
      return {
        status: 'warn',
        message: `Storage warnings detected.`,
        detail: parts.join('. ') + `. Total storages: ${total}.`,
      }
    }

    return {
      status: 'ok',
      message: `All ${total} storage(s) healthy.`,
    }
  })
}

async function pveSsh(meta: DiagnosticMeta): Promise<DiagnosticCheck> {
  if (!meta.sshEnabled) {
    return {
      id: 'pve.ssh',
      category: 'ssh',
      label: 'SSH connectivity',
      status: 'skip',
      message: 'SSH not enabled for this connection.',
      durationMs: 0,
    }
  }

  if (!meta.canManage) {
    return {
      id: 'pve.ssh',
      category: 'ssh',
      label: 'SSH connectivity',
      status: 'skip',
      message: 'SSH connectivity check requires the connection.manage permission.',
      durationMs: 0,
    }
  }

  return runCheck('pve.ssh', 'ssh', 'SSH connectivity', async () => {
    if (!meta.sshHost) {
      return { status: 'skip', message: 'No SSH host resolved; skipping SSH check.' }
    }

    // Import executeSSHDirect lazily to keep this module light in unit tests.
    const { executeSSHDirect } = await import('@/lib/ssh/exec')
    const result = await executeSSHDirect({
      host: meta.sshHost,
      port: meta.sshPort ?? 22,
      user: meta.sshUser ?? 'root',
      key: meta.sshKey,
      password: meta.sshPassword,
      passphrase: meta.sshPassphrase,
      command: 'hostname',
      timeoutMs: 8000,
    })

    if (result.success) {
      return {
        status: 'ok',
        message: `SSH reachable (hostname: ${result.output ?? 'ok'}).`,
      }
    }
    return {
      status: 'error',
      message: 'SSH connection failed.',
      detail: result.error,
    }
  }, 10000)
}

// ---------------------------------------------------------------------------
// PBS checks
// ---------------------------------------------------------------------------

async function pbsNetworkAndVersion(conn: PbsClientOptions): Promise<DiagnosticCheck> {
  return runCheck('pbs.network', 'network', 'PBS API reachability and version', async () => {
    const data = await pbsFetch<any>(conn, '/version')
    const version: string = data?.version ?? 'unknown'
    return { status: 'ok', message: `Connected to PBS ${version}` }
  })
}

async function pbsAuth(conn: PbsClientOptions): Promise<DiagnosticCheck> {
  return runCheck('pbs.auth', 'auth', 'PBS API token permissions', async () => {
    await pbsFetch<any>(conn, '/admin/datastore')
    return { status: 'ok', message: 'Token has read access to datastores.' }
  })
}

async function pbsDatastores(conn: PbsClientOptions): Promise<DiagnosticCheck> {
  return runCheck('pbs.datastore', 'datastore', 'PBS datastore health', async () => {
    const stores = await pbsFetch<any[]>(conn, '/admin/datastore')
    const storeList = stores ?? []

    const warnHigh: string[] = []
    const errFull: string[] = []
    const fetchFailed: string[] = []

    for (const s of storeList) {
      const name: string = s.store ?? s.name ?? '?'
      try {
        const status = await pbsFetch<any>(conn, `/admin/datastore/${encodeURIComponent(name)}/status`)
        const total: number = status?.total ?? 0
        const used: number = status?.used ?? 0
        if (total > 0) {
          const pct = used / total
          if (pct > 0.95) errFull.push(`${name} (${Math.round(pct * 100)}%)`)
          else if (pct > 0.85) warnHigh.push(`${name} (${Math.round(pct * 100)}%)`)
        }
      } catch {
        // Track datastores whose status fetch failed; do not discard silently.
        fetchFailed.push(name)
      }
    }

    const total = storeList.length
    const failedDetail = fetchFailed.length > 0
      ? `Status fetch failed for: ${fetchFailed.join(', ')}.`
      : undefined

    if (errFull.length > 0) {
      const parts = [`Full: ${errFull.join(', ')}.`, `Total: ${total}.`]
      if (failedDetail) parts.push(failedDetail)
      return {
        status: 'error',
        message: `${errFull.length} datastore(s) critically full (>95%).`,
        detail: parts.join(' '),
      }
    }
    if (warnHigh.length > 0 || fetchFailed.length > 0) {
      const parts: string[] = []
      if (warnHigh.length > 0) parts.push(`High: ${warnHigh.join(', ')}.`)
      if (failedDetail) parts.push(failedDetail)
      parts.push(`Total: ${total}.`)
      return {
        status: 'warn',
        message: warnHigh.length > 0
          ? `${warnHigh.length} datastore(s) above 85% usage.`
          : `Status fetch failed for ${fetchFailed.length} datastore(s).`,
        detail: parts.join(' '),
      }
    }

    return {
      status: 'ok',
      message: `All ${total} datastore(s) healthy.`,
    }
  })
}

// ---------------------------------------------------------------------------
// External (migration source) checks
// ---------------------------------------------------------------------------

async function externalReachability(meta: DiagnosticMeta): Promise<DiagnosticCheck> {
  return runCheck('ext.network', 'network', 'API host reachability', async () => {
    const { baseUrl } = meta

    if (!baseUrl) {
      return {
        status: 'skip',
        message: 'No base URL configured; cannot determine the endpoint to probe.',
      }
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(baseUrl)
    } catch {
      return {
        status: 'skip',
        message: 'Base URL could not be parsed; skipping reachability check.',
        detail: `Configured value: ${baseUrl}`,
      }
    }

    const host = parsedUrl.hostname
    const port = parsedUrl.port
      ? parseInt(parsedUrl.port, 10)
      : parsedUrl.protocol === 'http:' ? 80 : 443

    await tcpReachable(host, port)

    return {
      status: 'ok',
      message: `Reachable at ${host}:${port}`,
      detail: 'TCP connectivity confirmed. Deep API diagnostics are not available for migration-source hypervisors.',
    }
  })
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run all applicable health checks for the given connection and return
 * a structured report. Never throws -- individual check failures are
 * captured as 'error' status entries.
 *
 * @param pveConn  The loaded PVE client config (pass for pve connections).
 * @param pbsConn  The loaded PBS client config (pass for pbs connections).
 * @param meta     Connection metadata (type, hasCeph, sshEnabled, etc.).
 */
export async function runConnectionDiagnostics(
  meta: DiagnosticMeta,
  pveConn?: ProxmoxClientOptions,
  pbsConn?: PbsClientOptions,
): Promise<DiagnosticReport> {
  const reportStart = Date.now()
  let checks: DiagnosticCheck[] = []

  try {
    if (meta.type === 'pve' && pveConn) {
      const [networkCheck, authCheck, storageCheck, sshCheck] = await Promise.all([
        pveNetworkAndVersion(pveConn),
        pveAuth(pveConn),
        pveStorage(pveConn),
        pveSsh(meta),
      ])
      const clusterChecks = await pveCluster(pveConn, !!meta.hasCeph)
      checks = [networkCheck, authCheck, ...clusterChecks, storageCheck, sshCheck]
    } else if (meta.type === 'pbs' && pbsConn) {
      const [networkCheck, authCheck, datastoreCheck] = await Promise.all([
        pbsNetworkAndVersion(pbsConn),
        pbsAuth(pbsConn),
        pbsDatastores(pbsConn),
      ])
      checks = [networkCheck, authCheck, datastoreCheck]
    } else {
      // External migration-source types: vmware, xcpng, hyperv, nutanix, etc.
      const reachCheck = await externalReachability(meta)
      checks = [reachCheck]
    }
  } catch (e: any) {
    checks.push({
      id: 'runner.error',
      category: 'network',
      label: 'Diagnostic runner',
      status: 'error',
      message: e?.message || String(e),
      durationMs: 0,
    })
  }

  return {
    connectionId: meta.connectionId,
    type: meta.type,
    checks,
    summary: buildSummary(checks),
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - reportStart,
  }
}
