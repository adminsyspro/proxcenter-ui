// src/lib/proxmox/volumeOwnership.ts
// Who may reference an existing volume from a guest configuration.
//
// The connection's PVE credentials can attach any volume to any guest, so the
// decision is taken here: a disk key naming a volume that another guest owns,
// or importing from one, needs the hardware right on that owning guest. A
// grant that covers both guests (global, connection, node, or the two guests)
// passes, so moving a disk between one's own guests keeps working; a grant on
// the target guest alone does not open the neighbour's disks.
//
// vDC (iaas) tenants are first held to the stricter own-guest rule of
// lib/vdc/driveGuard.ts; this check then applies to them as to anyone.
import { NextResponse } from 'next/server'

import { pveFetch } from '@/lib/proxmox/client'
import { buildVmResourceId, checkPermission, PERMISSIONS } from '@/lib/rbac'
import { checkTenantGuestScope } from '@/lib/vdc/guestScope'
import { cicustomStorages, isTenantDiskKey } from '@/lib/vdc/drives'

type PveConn = Parameters<typeof pveFetch>[0]

const VOLID_RE = /^([A-Za-z][A-Za-z0-9._-]*):(.+)$/

// PVE's own volume grammars (PVE::Storage::*Plugin::parse_volname): a
// directory storage files a guest image under `<vmid>/`, the block and ZFS
// storages name it `vm-`, `base-`, `basevol-` or `subvol-<vmid>-`.
const OWNER_DIR_RE = /(?:^|\/)(\d+)\/[^/]+$/
const OWNER_NAME_RE = /^(?:vm|base|basevol|subvol)-(\d+)-/
const FRESH_ALLOCATION_RE = /^(?:\d+(?:\.\d+)?|cloudinit)$/

/**
 * Whose a referenced volume is:
 * - `free`: nobody's. A fresh allocation (`storage:32`), the cloud-init drive,
 *   an ISO on a drive, an image of an import directory as an import source.
 * - a guest id, read the way PVE reads it. A linked clone lives under its
 *   template (`base-100-disk-0/vm-105-disk-0`): the last guest named owns it,
 *   and on a directory storage the directory decides, not the file name.
 * - `unknown`: an existing object no guest can be named for (a backup file, a
 *   raw LUN, a path). It is held to the rule of a volume whose guest is gone.
 */
export type VolumeOwner = 'free' | 'unknown' | { vmid: string }

export function volumeOwner(volid: string, role: 'attach' | 'import'): VolumeOwner {
  const m = VOLID_RE.exec(volid)

  if (!m) return 'unknown'
  const rest = m[2]

  if (role === 'attach' && (FRESH_ALLOCATION_RE.test(rest) || rest.startsWith('iso/'))) return 'free'
  if (role === 'import' && rest.startsWith('import/')) return 'free'

  const vmid = OWNER_DIR_RE.exec(rest)?.[1] ?? OWNER_NAME_RE.exec(rest.slice(rest.lastIndexOf('/') + 1))?.[1]

  return vmid ? { vmid } : 'unknown'
}

const OPTION_RE = /^([A-Za-z][A-Za-z0-9_-]*)=(.*)$/

/**
 * The volumes a drive line names: the one it attaches and the one it imports
 * from. PVE reads the attached volume from the bare first field or from its
 * explicit key anywhere in the line (`file=` on a VM, `volume=` on a
 * container), so both spellings are read here.
 */
export function referencedVolumes(value: unknown): { attached: string[]; importFrom: string[] } {
  const attached: string[] = []
  const importFrom: string[] = []

  for (const part of String(value ?? '').split(',').map(p => p.trim()).filter(Boolean)) {
    const option = OPTION_RE.exec(part)

    if (!option) {
      if (VOLID_RE.test(part)) attached.push(part)
    } else if (option[1] === 'file' || option[1] === 'volume') {
      if (VOLID_RE.test(option[2])) attached.push(option[2])
    } else if (option[1] === 'import-from') {
      importFrom.push(option[2])
    }
  }

  return { attached, importFrom }
}

function refusal(key: string): NextResponse {
  return NextResponse.json(
    { error: `${key}: this volume is not one of this guest's disks. Attaching or importing it needs the hardware right on the guest it belongs to.` },
    { status: 403 },
  )
}

/**
 * Volumes the guest already carries on its disk keys: re-saving one of its own
 * lines is not a new reference. Only disk keys count, never a free-text field
 * the caller can write a volume name into.
 */
function heldVolumes(currentConfig: Record<string, unknown> | null | undefined, type: 'qemu' | 'lxc'): Set<string> {
  const held = new Set<string>()

  for (const [key, value] of Object.entries(currentConfig ?? {})) {
    if (typeof value !== 'string' || !isTenantDiskKey(key, type)) continue
    for (const volid of referencedVolumes(value).attached) held.add(volid)
  }

  return held
}

export interface ForeignVolumeCheck {
  connectionId: string
  conn: PveConn
  tenantId: string
  type: 'qemu' | 'lxc'
  body: Record<string, unknown>
  /** The guest being created or reconfigured. */
  targetVmid: string
  /** Its configuration before the write; absent on creation. */
  currentConfig?: Record<string, unknown> | null
}

/**
 * The disk keys of the body naming a volume that is not the guest's own, with
 * the guest it belongs to (null when no guest can be named for it).
 *
 * A guest's own volumes are the ones its configuration carries, not the ones
 * that bear its id: a volume named for the guest but absent from its disks
 * was left behind by an earlier guest of that id, on creation as on a later
 * update.
 */
function foreignReferences(check: ForeignVolumeCheck): Array<{ key: string; owner: string | null }> {
  const held = heldVolumes(check.currentConfig, check.type)
  const target = String(check.targetVmid)
  const foreign: Array<{ key: string; owner: string | null }> = []

  for (const [key, value] of Object.entries(check.body)) {
    if (!isTenantDiskKey(key, check.type)) continue
    const { attached, importFrom } = referencedVolumes(value)

    for (const volid of attached) {
      const owner = volumeOwner(volid, 'attach')

      if (owner === 'free' || held.has(volid)) continue
      foreign.push({ key, owner: owner === 'unknown' || owner.vmid === target ? null : owner.vmid })
    }
    for (const volid of importFrom) {
      const owner = volumeOwner(volid, 'import')

      if (owner === 'free') continue
      if (owner === 'unknown') foreign.push({ key, owner: null })
      // Copying one of its own disks is the guest's business; a volume it
      // merely has attached from another guest is still that guest's.
      else if (owner.vmid !== target) foreign.push({ key, owner: owner.vmid })
      else if (!held.has(volid)) foreign.push({ key, owner: null })
    }
  }

  return foreign
}

/**
 * The 403 to answer with when the body references a volume of a guest the
 * caller may not reconfigure, or null when every reference is the caller's to
 * make. Costs one cluster listing, and only when such a volume is named.
 */
export async function foreignVolumeRefusal(check: ForeignVolumeCheck): Promise<NextResponse | null> {
  const foreign = foreignReferences(check)

  if (foreign.length === 0) return null

  const resources = foreign.some(f => f.owner !== null)
    ? await pveFetch<Array<{ vmid?: number | string; node?: string; type?: string }>>(check.conn, '/cluster/resources?type=vm')
    : []
  const guests = new Map((Array.isArray(resources) ? resources : []).map(r => [String(r.vmid), r]))

  for (const { key, owner } of foreign) {
    const guest = owner === null ? undefined : guests.get(owner)
    const guestType = guest?.type === 'lxc' ? 'lxc' : 'qemu'

    if (owner === null || !guest?.node) {
      // No guest answers for this volume: only a grant on the whole
      // connection, in the provider's own tenant, may pick it up.
      if (check.tenantId !== 'default') return refusal(key)
      if (await checkPermission(PERMISSIONS.VM_CONFIG_HARDWARE, 'connection', check.connectionId)) return refusal(key)
      continue
    }
    if (await checkTenantGuestScope(check.tenantId, check.conn, check.connectionId, guestType, guest.node, owner)) return refusal(key)
    if (await checkPermission(PERMISSIONS.VM_CONFIG_HARDWARE, 'vm', buildVmResourceId(check.connectionId, guest.node, guestType, owner))) return refusal(key)
  }

  return null
}

/**
 * `cicustom` points cloud-init at files of a storage (`user=local:snippets/x.yaml`):
 * whatever the file holds is handed to the guest. Each storage named must be
 * one the caller may read content from; a line that is not in that form is
 * refused rather than forwarded.
 */
export async function cicustomRefusal(connectionId: string, value: unknown): Promise<NextResponse | null> {
  const storages = cicustomStorages(value)

  if (storages === null) {
    return NextResponse.json({ error: 'cicustom: expected user=, network=, meta= or vendor= followed by storage:snippets/file' }, { status: 400 })
  }
  for (const storage of storages) {
    if (await checkPermission(PERMISSIONS.STORAGE_CONTENT, 'storage', `${connectionId}:${storage}`)) {
      return NextResponse.json({ error: `cicustom: storage "${storage}" is outside your scope.` }, { status: 403 })
    }
  }

  return null
}
