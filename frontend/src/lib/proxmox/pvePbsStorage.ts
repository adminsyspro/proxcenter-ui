import { pveFetch } from './client'
import type { PveConn } from '@/lib/connections/getConnection'

export function sanitizeStorageName(tenantSlug: string, vdcSlug: string, prefix = 'pbs-'): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const core = `${clean(tenantSlug)}-${clean(vdcSlug)}`.slice(0, 40 - prefix.length)


return `${prefix}${core}`
}

export async function pbsStorageExists(conn: PveConn, storage: string): Promise<boolean> {
  try {
    const r = await pveFetch<any>(conn, `/storage/${encodeURIComponent(storage)}`)


return !!r
  } catch (e: any) {
    const msg = String(e?.message ?? '')


    // PVE returns 500 "storage 'X' does not exist" for missing storages (non-standard).
    if (/\b404\b/.test(msg) || /does not exist/i.test(msg)) return false
    throw e
  }
}

export interface CreatePbsStorageArgs {
  storage: string
  server: string
  datastore: string
  namespace: string
  username: string
  password: string
  fingerprint: string
  nodes: string[]
  port?: number
}

// Errors PVE bubbles up when its `proxmox-backup-client status` probe
// fails because PBS hasn't propagated the just-minted token / ACL / namespace
// yet. The probe shells out a CLI and surfaces a generic message, so we
// match on substrings rather than hoping for a stable error code.
const PROBE_RETRY_PATTERNS: RegExp[] = [
  /cannot find datastore/i,
  /no such datastore/i,
  /403/,
  /401/,
  /authentication failed/i,
  /permission check failed/i,
  /no such namespace/i,
]

const STORAGE_RETRY_DELAYS_MS = [1500, 3000, 5000] // total wait ~9.5s

export async function createPbsStorage(conn: PveConn, args: CreatePbsStorageArgs): Promise<void> {
  if (await pbsStorageExists(conn, args.storage)) return
  const params = new URLSearchParams()

  params.append('storage', args.storage)
  params.append('type', 'pbs')
  params.append('server', args.server)
  params.append('datastore', args.datastore)
  params.append('namespace', args.namespace)
  params.append('username', args.username)
  params.append('password', args.password)
  params.append('fingerprint', args.fingerprint)
  params.append('content', 'backup')
  if (args.nodes.length) params.append('nodes', args.nodes.join(','))
  if (args.port) params.append('port', String(args.port))
  console.log(`[pve-pbs-storage] POST /storage (form-encoded, secret redacted): storage=${args.storage} server=${args.server} datastore=${args.datastore} namespace=${args.namespace} username=${args.username} fingerprint=${args.fingerprint} nodes=${args.nodes.join(',')}`)

  // Retry with backoff when PVE's PBS probe fails for transient propagation
  // reasons (token / ACL / namespace just minted on PBS, PVE's CLI probe
  // sees the old config). The same call manually a few seconds later
  // succeeds — that's the symptom users hit on the first auto-bind.
  let lastError: any = null

  for (let attempt = 0; attempt < STORAGE_RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      await pveFetch(conn, '/storage', { method: 'POST', body: params })

return
    } catch (e: any) {
      lastError = e
      const msg = String(e?.message ?? '')
      const isProbeError = PROBE_RETRY_PATTERNS.some(rx => rx.test(msg))
      const willRetry = isProbeError && attempt < STORAGE_RETRY_DELAYS_MS.length

      console.warn(`[pve-pbs-storage] attempt ${attempt + 1} failed: ${msg}${willRetry ? ` — retrying in ${STORAGE_RETRY_DELAYS_MS[attempt]}ms` : ''}`)
      if (!willRetry) throw e
      await new Promise(r => setTimeout(r, STORAGE_RETRY_DELAYS_MS[attempt]))
    }
  }


  // Safety net — shouldn't be reached.
  throw lastError ?? new Error('createPbsStorage: exhausted retries')
}

export async function deletePbsStorage(conn: PveConn, storage: string): Promise<void> {
  try {
    await pveFetch(conn, `/storage/${encodeURIComponent(storage)}`, { method: 'DELETE' })
  } catch (e: any) {
    const msg = String(e?.message ?? '')

    if (!/\b404\b/.test(msg) && !/does not exist/i.test(msg)) throw e
  }
}
