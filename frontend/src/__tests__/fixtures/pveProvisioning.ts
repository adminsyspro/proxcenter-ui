/**
 * Frozen hand-written fixture for LXC / VM provisioning dialog tests.
 * Do NOT import mock-data.json or demoResponse. All data is static.
 */

export const connections = [
  { id: 'conn-1', name: 'pve-cluster-1' },
]

export const nodes = [
  {
    node: 'pve1',
    status: 'online',
    cpu: 0.1,
    maxcpu: 4,
    mem: 512 * 1024 * 1024,
    maxmem: 8 * 1024 * 1024 * 1024,
  },
]

export const pools = [
  { poolid: 'pool-dev', comment: 'Development pool' },
  { poolid: 'pool-prod', comment: 'Production pool' },
]

/**
 * Storage entries:
 *   - 'local' has both vztmpl (template) and rootdir (disk) content
 *   - 'local-zfs' has rootdir content only
 * The 'node' field associates the storage with a specific node.
 */
export const storage = [
  {
    storage: 'local',
    content: 'rootdir,images,vztmpl',
    node: 'pve1',
  },
  {
    storage: 'local-zfs',
    content: 'rootdir,images',
    node: 'pve1',
  },
]

export const networkChoices = [
  { name: 'vmbr0' },
  { name: 'vmbr1' },
]

export const templates = [
  {
    volid: 'local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst',
    size: 120 * 1024 * 1024,
    format: 'tar.zst',
  },
  {
    volid: 'local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.gz',
    size: 200 * 1024 * 1024,
    format: 'tar.gz',
  },
]

/** nextid is not used by CreateLxcDialog (it computes locally from allVms). */
export const nextid = 100

// ------------------------------------------------------------------ //
// VM dialog additions (EXTEND-only -- do NOT mutate the exports above)
// ------------------------------------------------------------------ //

/**
 * vmStorage: storage entries used by CreateVmDialog tests.
 *
 * The single entry has both 'iso' and 'images' content and shared=true, so:
 *   - filteredIso (content.includes('iso') && shared) picks 'local-vm' for ISO storage.
 *   - filteredDisk (content.includes('images') && shared) picks 'local-vm' for disk storage.
 *
 * This causes the dialog to auto-select the ISO storage and auto-fill the
 * first disk's storage field, which unblocks the Create button (resolvedNode
 * and vmid are set via the nextid fetch; disk storage set here).
 */
export const vmStorage = [
  {
    storage: 'local-vm',
    content: 'images,iso,rootdir',
    shared: true,
  },
]

/**
 * vdcs: empty list -- no vDC quota applies to the provider tenant (admin).
 * The dialog reads json.data and finds a match by connectionId; no match
 * means vdcQuota stays null and all quota checks pass unconditionally.
 */
export const vdcs: unknown[] = []

// ------------------------------------------------------------------ //
// RestoreVmDialog additions (EXTEND-only -- do NOT mutate exports above)
// ------------------------------------------------------------------ //

/**
 * resources: a minimal slice of the /api/v1/connections/:id/resources
 * response used by RestoreVmDialog to populate usedVmIds. Each entry
 * must carry a numeric vmid field. We seed one VM (100) as already existing
 * so the dialog auto-enables the "Unique MACs" toggle for VMID 100.
 */
export const resources = [
  { vmid: 100, name: 'test-vm', status: 'running', type: 'qemu', node: 'pve1' },
]

/**
 * backupRef: a minimal BackupRef using the volid path so the dialog does not
 * fall through to the "Backup reference incomplete" error branch. The volid
 * is a valid PVE backup volume reference that the backend accepts directly
 * without PBS coordinate resolution.
 */
export const backupRef = {
  volid: 'local:backup/vzdump-qemu-100-2025_01_15-10_00_00.vma.zst',
  vmid: 100,
  backupTime: 1736935200,
}
