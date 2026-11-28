/*
   Browser side of the Ceph provisioning routes (ui#1450): the URLs and one
   call that never throws. It keeps what the server answered: the UPID and
   node of a started task, a task started without a PVE task yet (pending),
   or the error with its code and the details a dialog shows.
*/

export interface CephProvisionResult {
  ok: boolean
  status: number
  upid?: string
  node?: string
  pending?: boolean
  error?: string
  code?: string
  /** Guest disks still on a pool (POOL_HAS_GUEST_DISKS). */
  disks?: string[]
  /** Storages that could not be read (POOL_GUESTS_UNKNOWN). */
  storages?: string[]
  /** What pveceph printed before it failed (PVECEPH_FAILED). */
  output?: string
  message?: string
  /** Placement groups an OSD destruction would leave without enough copies (OSD_NOT_SAFE). */
  numNotOkPgs?: number | null
}

const enc = encodeURIComponent
const base = (connId: string) => `/api/v1/connections/${enc(connId)}`

export const cephPoolsUrl = (connId: string) => `${base(connId)}/ceph/pools`
export const cephPoolUrl = (connId: string, pool: string, opts: { removeStorages?: boolean } = {}) =>
  `${base(connId)}/ceph/pools/${enc(pool)}${opts.removeStorages ? '?removeStorages=1' : ''}`

const node = (connId: string, n: string) => `${base(connId)}/nodes/${enc(n)}`
export const cephDisksUrl = (connId: string, n: string) => `${node(connId, n)}/ceph/disks`
export const cephOsdCreateUrl = (connId: string, n: string) => `${node(connId, n)}/ceph/osd`
export const cephOsdUrl = (connId: string, n: string, osd: number, opts: { cleanup?: boolean } = {}) =>
  `${node(connId, n)}/ceph/osd/${osd}${opts.cleanup ? '?cleanup=1' : ''}`

/** What the server may add to a refusal, kept as is for the dialog. */
const DETAILS = ['code', 'disks', 'storages', 'output', 'message', 'numNotOkPgs'] as const

export async function sendCephTask(url: string, method: 'POST' | 'PUT' | 'DELETE', body?: Record<string, unknown>): Promise<CephProvisionResult> {
  try {
    const init: RequestInit = body === undefined
      ? { method }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    const res = await fetch(url, init)
    const json = await res.json().catch(() => ({}))

    if (res.ok) {
      const data = json?.data ?? {}
      const out: CephProvisionResult = { ok: true, status: res.status }
      if (typeof data.upid === 'string') out.upid = data.upid
      if (typeof data.node === 'string') out.node = data.node
      if (data.pending === true) out.pending = true
      return out
    }

    const out: CephProvisionResult = { ok: false, status: res.status, error: json?.error || `HTTP ${res.status}` }
    for (const key of DETAILS) {
      if (json?.[key] !== undefined) (out as any)[key] = json[key]
    }
    return out
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message || 'Network error' }
  }
}
