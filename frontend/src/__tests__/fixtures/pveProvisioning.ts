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
