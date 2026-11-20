// What becomes of a target storage picked for an intra-cluster migration (#1402).
//
// PVE validates `targetstorage` and then, in two cases, takes a path that never
// reads it, so the migration ends OK with the disks where they were. Measured
// on PVE 9.2.26:
//   - HA-managed guest, PVE/API2/Qemu.pm and LXC.pm migrate_vm: the request
//     becomes `ha-manager migrate <sid> <node>`, which carries no storage.
//   - volume replicated to the target node, PVE/QemuServer.pm
//     vm_migrate_alloc_nbd_disks(): the replica already on the target is
//     re-used before the storage map is applied.
// For an HA guest the same result is reached by moving the local disks to the
// (shared) storage first: the HA migration then has nothing left to copy.
//
// Pure module: the dialog and the migrate route both run it.

import { isDiskKey, volidOfDrive } from '@/lib/proxmox/snapshotRefs'
import { isSharedStorage } from '@/lib/proxmox/storage'
import { storageSupportsReplication } from './ccm-prereqs.types'

export type TargetStorageBlockReason =
  /** HA guest: the storage is not a shared one reachable from the source node. */
  | 'ha-target-not-shared'
  /** HA container that runs: PVE only moves the volumes of a stopped container. */
  | 'ha-running-container'
  /** HA VM that runs: PVE only moves a TPM state offline. */
  | 'ha-tpm-running'
  /** A replication job holds the volumes on their storage. */
  | 'replicated'

export type TargetStoragePlan =
  /** PVE applies the target storage itself, or there is nothing to remap. */
  | { kind: 'direct' }
  /** Move these disks to the target storage, then migrate without one. */
  | { kind: 'move-first'; disks: Array<{ id: string; volid: string }> }
  /** The target storage cannot be honoured for these volumes. */
  | { kind: 'blocked'; reason: TargetStorageBlockReason; volids: string[] }

/** The storage.cfg facts the rule reads, keyed by storage id. */
export interface TargetStorageFacts {
  type?: string
  shared?: number | boolean
  /** Comma-separated node restriction, absent when the storage is everywhere. */
  nodes?: string
}

export interface TargetStoragePlanInput {
  guestType: 'qemu' | 'lxc'
  running: boolean
  sourceNode: string
  targetNode: string
  /** Storage picked for the disks, none when they keep theirs. */
  targetStorage?: string
  /** The guest's current config. */
  config: Record<string, unknown>
  storages: Record<string, TargetStorageFacts>
  haManaged: boolean
  /** Target nodes of the guest's replication jobs. */
  replicationTargets: readonly string[]
}

interface LocalDisk {
  id: string
  volid: string
  replicable: boolean
}

function isCdrom(value: string): boolean {
  return /(?:^|,)media=cdrom(?:,|$)/.test(value)
}

/** The disks a target storage would remap: local, and not already on it. */
function remappedDisks(input: TargetStoragePlanInput, targetStorage: string): LocalDisk[] {
  const disks: LocalDisk[] = []

  for (const [id, value] of Object.entries(input.config)) {
    if (!isDiskKey(id) || typeof value !== 'string' || isCdrom(value)) continue

    const volid = volidOfDrive(value)
    const storage = volid?.includes(':') ? volid.split(':')[0] : null
    if (!volid || !storage || storage === targetStorage) continue

    const facts = input.storages[storage]
    if (facts && isSharedStorage(facts)) continue

    disks.push({
      id,
      volid,
      replicable: storageSupportsReplication(facts?.type) && !/(?:^|,)replicate=0(?:,|$)/.test(value),
    })
  }

  return disks.sort((a, b) => a.id.localeCompare(b.id))
}

function availableOn(facts: TargetStorageFacts, node: string): boolean {
  return !facts.nodes || facts.nodes.split(',').map(n => n.trim()).includes(node)
}

export function targetStoragePlan(input: TargetStoragePlanInput): TargetStoragePlan {
  const { targetStorage } = input
  if (!targetStorage) return { kind: 'direct' }

  const disks = remappedDisks(input, targetStorage)
  if (disks.length === 0) return { kind: 'direct' }

  // PVE keeps a replicated volume on the replica's storage when migrating to
  // the replication target. Moving one off its storage for an HA guest would
  // break the job whatever its target, so it is never offered.
  const jobHoldsDisks = input.replicationTargets.includes(input.targetNode)
    || (input.haManaged && input.replicationTargets.length > 0)
  const replicated = jobHoldsDisks ? disks.filter(d => d.replicable) : []
  if (replicated.length > 0) {
    return { kind: 'blocked', reason: 'replicated', volids: replicated.map(d => d.volid) }
  }

  if (!input.haManaged) return { kind: 'direct' }

  const volids = disks.map(d => d.volid)
  const target = input.storages[targetStorage]
  if (!target || !isSharedStorage(target) || !availableOn(target, input.sourceNode)) {
    return { kind: 'blocked', reason: 'ha-target-not-shared', volids }
  }

  if (input.running && input.guestType === 'lxc') {
    return { kind: 'blocked', reason: 'ha-running-container', volids }
  }

  const tpm = disks.filter(d => /^tpmstate\d+$/.test(d.id))
  if (input.running && tpm.length > 0) {
    return { kind: 'blocked', reason: 'ha-tpm-running', volids: tpm.map(d => d.volid) }
  }

  return { kind: 'move-first', disks: disks.map(({ id, volid }) => ({ id, volid })) }
}

const BLOCK_TEXT: Record<TargetStorageBlockReason, string> = {
  'ha-target-not-shared':
    'this guest is HA-managed and PVE ignores a target storage for an HA migration. The disks can only be moved beforehand to a shared storage available on the source node: pick one, or remove the guest from HA',
  'ha-running-container':
    'this container is HA-managed and PVE ignores a target storage for an HA migration. Its volumes can only be moved while it is stopped: stop it, or remove it from HA',
  'ha-tpm-running':
    'this VM is HA-managed and PVE ignores a target storage for an HA migration. Its TPM state can only be moved while the VM is stopped: shut it down, or remove it from HA',
  replicated:
    'a replication job holds these volumes on their storage, and PVE keeps them there when migrating: keep the current storage, or remove the replication job first',
}

/** One readable sentence for the migrate route's error. Empty for a direct migration. */
export function describeTargetStoragePlan(plan: TargetStoragePlan, targetStorage: string): string {
  if (plan.kind === 'direct') return ''

  if (plan.kind === 'move-first') {
    const ids = plan.disks.map(d => d.id).join(', ')

    return `This guest is HA-managed and PVE ignores a target storage for an HA migration. Move ${ids} to ${targetStorage} first (disk move), then migrate without a target storage.`
  }

  return `Target storage ${targetStorage} cannot be applied to ${plan.volids.join(', ')}: ${BLOCK_TEXT[plan.reason]}.`
}
