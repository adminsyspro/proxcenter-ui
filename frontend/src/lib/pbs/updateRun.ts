// Update of a Proxmox Backup Server through the orchestrator (ui#1428): what
// the routes under /api/v1/pbs/[id]/update send, and what they read back.

import { getConnectionByIdOrNull } from '@/lib/connections/getConnection'
import { decryptSecret } from '@/lib/crypto/secret'
import { pbsHostOf, pbsIdentityOf, samePbsServer } from '@/lib/guestFileRestore/pbsPveStorages'
import { pveFetch } from '@/lib/proxmox/client'
import { getSessionPrisma } from '@/lib/tenant'

import { PBS_UPCOMING_JOB_WINDOW, type PbsUpdateOptions } from './updateOptions'

export { parsePbsUpdateOptions } from './updateOptions'

export type PbsUpdateRequest =
  | { ok: true, payload: { connection_id: string, config: Record<string, unknown> } }
  | { ok: false, status: number, code: 'not_found' | 'ssh_disabled' | 'ssh_secret', error: string }

/**
 * The orchestrator request of a preflight or a run: the server address and
 * the SSH credentials saved on the connection, decrypted for this one call.
 */
export async function buildPbsUpdateRequest(id: string, options: PbsUpdateOptions): Promise<PbsUpdateRequest> {
  const db = await getSessionPrisma()
  const connection = await db.connection.findUnique({
    where: { id },
    select: {
      name: true, type: true, baseUrl: true,
      sshEnabled: true, sshPort: true, sshUser: true, sshAuthMethod: true, sshKeyEnc: true, sshPassEnc: true,
    },
  })

  if (connection?.type !== 'pbs') {
    return { ok: false, status: 404, code: 'not_found', error: 'Connection not found' }
  }
  if (!connection.sshEnabled) {
    return { ok: false, status: 400, code: 'ssh_disabled', error: 'SSH is not enabled for this backup server' }
  }

  const credentials: Record<string, unknown> = {
    sshEnabled: true,
    sshPort: connection.sshPort || 22,
    sshUser: connection.sshUser || 'root',
    sshAuthMethod: connection.sshAuthMethod,
  }

  try {
    if (connection.sshKeyEnc) credentials.sshKey = decryptSecret(connection.sshKeyEnc)
    if (connection.sshPassEnc) {
      const secret = decryptSecret(connection.sshPassEnc)

      if (connection.sshAuthMethod === 'key') credentials.sshPassphrase = secret
      else credentials.sshPassword = secret
    }
  } catch {
    return { ok: false, status: 500, code: 'ssh_secret', error: 'Failed to decrypt SSH credentials' }
  }

  return {
    ok: true,
    payload: {
      connection_id: id,
      config: {
        auto_reboot: options.autoReboot,
        reboot_timeout: options.rebootTimeout,
        notify_on_complete: true,
        notify_on_error: true,
        ssh_credentials: credentials,
        pbs: {
          name: connection.name,
          host: pbsHostOf(connection.baseUrl),
          datastore_read_only: options.datastoreReadOnly,
        },
      },
    },
  }
}

export interface PbsBackupJob {
  connectionName: string
  id: string
  storage: string
  schedule: string
  /** Unix seconds of the next run, null when Proxmox VE does not say. */
  nextRun: number | null
}

/**
 * The enabled Proxmox VE backup jobs that write to this backup server, soonest
 * first. One /storage and one /cluster/backup read per cluster, on the
 * preflight only; a cluster that does not answer simply lists no job.
 */
export async function pbsBackupJobs(id: string): Promise<PbsBackupJob[]> {
  const db = await getSessionPrisma()
  const pbs = await db.connection.findUnique({ where: { id }, select: { baseUrl: true, fingerprint: true } })

  if (!pbs) return []
  const identity = pbsIdentityOf(pbs)
  const clusters = await db.connection.findMany({ where: { type: 'pve' }, select: { id: true, name: true }, orderBy: { name: 'asc' } })

  const perCluster = await Promise.all(clusters.map(async (c): Promise<PbsBackupJob[]> => {
    try {
      const conn = await getConnectionByIdOrNull(c.id)

      if (!conn) return []
      const storages = await pveFetch<any[]>(conn, '/storage', {}, { timeoutMs: 8_000 })
      const targets = new Set(
        (Array.isArray(storages) ? storages : [])
          .filter(s => s?.type === 'pbs' && samePbsServer(s, identity))
          .map(s => String(s.storage)),
      )

      if (targets.size === 0) return []
      const jobs = await pveFetch<any[]>(conn, '/cluster/backup', {}, { timeoutMs: 8_000 })

      return (Array.isArray(jobs) ? jobs : [])
        .filter(j => targets.has(String(j?.storage)) && j?.enabled !== 0 && j?.enabled !== false)
        .map(j => ({
          connectionName: c.name,
          id: String(j.id ?? ''),
          storage: String(j.storage),
          schedule: String(j.schedule ?? ''),
          nextRun: Number(j['next-run']) > 0 ? Number(j['next-run']) : null,
        }))
    } catch {
      return []
    }
  }))

  return perCluster.flat().sort((a, b) => (a.nextRun ?? Infinity) - (b.nextRun ?? Infinity))
}

/** The jobs due within the warning window, counted from `now` (Unix seconds). */
export function upcomingBackupJobs(jobs: PbsBackupJob[], now: number): PbsBackupJob[] {
  return jobs.filter(j => j.nextRun !== null && j.nextRun >= now && j.nextRun - now <= PBS_UPCOMING_JOB_WINDOW)
}

/** The newest backup server run of a list the orchestrator returned for one connection. */
export function latestPbsRun<T extends { kind?: string, created_at?: string }>(runs: unknown): T | null {
  if (!Array.isArray(runs)) return null
  const pbsRuns = (runs as T[]).filter(r => r?.kind === 'pbs')

  pbsRuns.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))

  return pbsRuns[0] ?? null
}
