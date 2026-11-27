import { randomBytes } from 'node:crypto'

import type { PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

import type { ConfVolume, GuestType } from './guestConf'

/**
 * Proves, per storage, that a storage of the target cluster is the very
 * backend the guest disks sit on (ui#1460). A storage name proves nothing:
 * the lab has a `CephStoragePool` on both clusters over two distinct Ceph
 * clusters, and trusting the name would boot a guest without its disks.
 *
 * The proof goes through the Proxmox API only: a 4 MiB probe volume is
 * allocated on the source storage, looked for on each target candidate, then
 * removed. The candidate that sees it must also list every volume of the
 * guest on that storage (an RBD namespace or an NFS sub-export can share a
 * backend and still show other volumes).
 *
 * Load: per storage of the guest, one allocation, one listing per target
 * storage of the same type and one removal, plus one read of the storage
 * lists of each cluster.
 */

export type PveCall = <T>(conn: PveConn, path: string, init?: RequestInit) => Promise<T>

export type ProofSide = { conn: PveConn; node: string }

export type StorageProof =
  | { storage: string; ok: true; target: string }
  | {
      storage: string
      ok: false
      /**
       * `local-type`: a type no other cluster can reach (ZFS pool, LVM-thin).
       * `no-candidate`: no active target storage of the same type for this
       * guest kind. `probe-failed`: Proxmox refused the probe volume.
       * `not-visible`: no candidate sees the probe. `volumes-missing`: the
       * candidate that sees it lacks some of the guest volumes.
       */
      reason: 'local-type' | 'no-candidate' | 'probe-failed' | 'not-visible' | 'volumes-missing'
      detail?: string
      missing?: string[]
    }

/** Storage types whose volumes live on one node, never on a backend another cluster reaches. */
const LOCAL_TYPES = new Set(['zfspool', 'lvmthin', 'btrfs'])

const PROBE_SIZE = '4M'

type StorageConfig = { storage?: string; type?: string }
type NodeStorage = { storage?: string; type?: string; content?: string; active?: number; enabled?: number }
type ContentEntry = { volid?: string }

/** The name of a volume inside its storage: `vm-100-disk-0`, `100/vm-100-disk-2.qcow2`. */
function volname(volid: string): string {
  return volid.slice(volid.indexOf(':') + 1)
}

/** A file storage keeps the probe as `<vmid>/<name>.raw`. */
function isProbe(volid: string, probe: string): boolean {
  const base = volname(volid).split('/').pop() || ''

  return base === probe || base.startsWith(`${probe}.`)
}

function candidatesFor(storage: string, type: string, guest: GuestType, targets: NodeStorage[]): string[] {
  const content = guest === 'lxc' ? 'rootdir' : 'images'
  const names = targets
    .filter(s => s.type === type && s.active === 1 && s.enabled !== 0)
    .filter(s => String(s.content || '').split(',').includes(content))
    .map(s => String(s.storage))

  return [...names.filter(n => n === storage), ...names.filter(n => n !== storage)]
}

async function probeStorage(
  pve: PveCall,
  input: { source: ProofSide; target: ProofSide; vmid: string; probe: string },
  storage: string,
  candidates: string[],
  wanted: string[],
): Promise<StorageProof> {
  const { source, target, vmid, probe } = input
  let probeVolid: string
  try {
    probeVolid = await pve<string>(source.conn, `/nodes/${encodeURIComponent(source.node)}/storage/${encodeURIComponent(storage)}/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ vmid, filename: probe, size: PROBE_SIZE }).toString(),
    })
  } catch (e: any) {
    return { storage, ok: false, reason: 'probe-failed', detail: String(e?.message || e) }
  }

  // One candidate at a time, stopping at the first that sees the probe.
  const lookAt = async (index: number): Promise<StorageProof> => {
    if (index >= candidates.length) return { storage, ok: false, reason: 'not-visible' }
    const candidate = candidates[index]
    const listing = await pve<ContentEntry[]>(
      target.conn,
      `/nodes/${encodeURIComponent(target.node)}/storage/${encodeURIComponent(candidate)}/content?vmid=${encodeURIComponent(vmid)}`,
    ).catch(() => [] as ContentEntry[])
    const volids = (Array.isArray(listing) ? listing : []).map(e => String(e?.volid || ''))
    if (!volids.some(v => isProbe(v, probe))) return lookAt(index + 1)

    const present = new Set(volids.map(volname))
    const missing = wanted.filter(v => !present.has(volname(v)))
    if (missing.length > 0) return { storage, ok: false, reason: 'volumes-missing', missing }

    return { storage, ok: true, target: candidate }
  }

  try {
    return await lookAt(0)
  } finally {
    await pve(source.conn, `/nodes/${encodeURIComponent(source.node)}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(probeVolid)}`, { method: 'DELETE' })
      .catch((e: any) => {
        console.warn(`[shared-handover] probe volume ${probeVolid} was not removed:`, String(e?.message || e).replace(/[\r\n]/g, ' '))
      })
  }
}

export async function proveSharedStorages(input: {
  source: ProofSide
  target: ProofSide
  vmid: string
  type: GuestType
  volumes: ConfVolume[]
  pve?: PveCall
  randomId?: () => string
}): Promise<StorageProof[]> {
  const pve: PveCall = input.pve ?? (pveFetch as PveCall)
  const randomId = input.randomId ?? (() => randomBytes(4).toString('hex'))
  const storages = [...new Set(input.volumes.map(v => v.storage))]
  if (storages.length === 0) return []

  const sourceConfig = await pve<StorageConfig[]>(input.source.conn, '/storage')
  const targetStorages = await pve<NodeStorage[]>(input.target.conn, `/nodes/${encodeURIComponent(input.target.node)}/storage`)
  const types = new Map((Array.isArray(sourceConfig) ? sourceConfig : []).map(s => [String(s.storage), String(s.type)]))

  const proveOne = async (storage: string): Promise<StorageProof> => {
    const type = types.get(storage)
    if (type && LOCAL_TYPES.has(type)) return { storage, ok: false, reason: 'local-type' }
    const candidates = type ? candidatesFor(storage, type, input.type, Array.isArray(targetStorages) ? targetStorages : []) : []
    if (candidates.length === 0) return { storage, ok: false, reason: 'no-candidate' }
    const wanted = [...new Set(input.volumes.filter(v => v.storage === storage).map(v => v.volid))]

    return probeStorage(pve, { ...input, probe: `vm-${input.vmid}-pxcprobe-${randomId()}` }, storage, candidates, wanted)
  }

  // One storage after the other: a single probe volume exists at any time.
  const proveFrom = async (index: number, proofs: StorageProof[]): Promise<StorageProof[]> =>
    index >= storages.length ? proofs : proveFrom(index + 1, [...proofs, await proveOne(storages[index])])

  return proveFrom(0, [])
}
