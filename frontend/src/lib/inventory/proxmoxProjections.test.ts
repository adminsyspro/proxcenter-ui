import { describe, expect, it } from 'vitest'

import { readNodeStatus, readStorageResources } from './proxmoxProjections'

/** Copied from a real PVE 9.2.11 node on 2026-09-11, trimmed to what is read. */
const NODE_STATUS = {
  'current-kernel': { release: '7.0.2-6-pve', sysname: 'Linux' },
  kversion: 'Linux 7.0.2-6-pve',
  uptime: 528208,
  cpu: 0.0779,
  wait: 0.0021,
  idle: 0,
  swap: { used: 28672, free: 2550104064, total: 2550132736 },
  memory: { used: 14669058048, free: 10527633408, total: 25196691456 },
  rootfs: { avail: 11141296128, free: 11982450688, used: 6001053696, total: 17983504384 },
  pveversion: 'pve-manager/9.2.11/f6997e698c7933ea',
  cpuinfo: { cpus: 8, model: 'Common KVM processor', sockets: 1 },
  ksm: { shared: 0 },
}

describe('readNodeStatus', () => {
  it('reads every field the inventory keeps from a real payload', () => {
    expect(readNodeStatus(NODE_STATUS)).toEqual({
      mem: 14669058048,
      maxmem: 25196691456,
      loadavg: undefined,
      iowait: 0.0021,
      swapUsed: 28672,
      swapTotal: 2550132736,
      rootfsUsed: 6001053696,
      rootfsTotal: 17983504384,
      cores: 8,
      pveVersion: 'pve-manager/9.2.11/f6997e698c7933ea',
      kernel: '7.0.2-6-pve',
    })
  })

  /**
   * Proxmox sends the load average as an array of STRINGS. Passing it through
   * would put `"0.61"` where a metric value belongs, and `Number` of a bad
   * entry is NaN, which makes Prometheus reject the entire scrape.
   */
  it('parses the load average, which arrives as strings', () => {
    expect(readNodeStatus({ ...NODE_STATUS, loadavg: ['0.61', '0.55', '0.49'] }).loadavg)
      .toEqual([0.61, 0.55, 0.49])
  })

  it('drops a non-numeric load entry rather than publishing NaN', () => {
    expect(readNodeStatus({ loadavg: ['0.61', 'n/a', '0.49'] }).loadavg).toEqual([0.61, 0.49])
  })

  it('keeps only the first three load figures, whatever the node sends', () => {
    expect(readNodeStatus({ loadavg: ['1', '2', '3', '4', '5'] }).loadavg).toEqual([1, 2, 3])
  })

  it('omits the load entirely when every entry is unusable', () => {
    expect(readNodeStatus({ loadavg: ['n/a'] }).loadavg).toBeUndefined()
  })

  /**
   * A total of 0 means the node reports no such resource, most often a node
   * with no swap. Publishing 0/0 would make every ratio downstream divide by
   * zero rather than simply having nothing to say.
   */
  it('omits a resource whose total is zero rather than reporting 0 of 0', () => {
    const facts = readNodeStatus({ swap: { used: 0, total: 0 }, memory: { used: 0, total: 0 } })
    expect(facts.swapTotal).toBeUndefined()
    expect(facts.swapUsed).toBeUndefined()
    expect(facts.maxmem).toBeUndefined()
  })

  it('survives an empty, null or undefined payload', () => {
    for (const payload of [{}, null, undefined]) {
      expect(() => readNodeStatus(payload)).not.toThrow()
      expect(readNodeStatus(payload).cores).toBeUndefined()
    }
  })

  it('ignores an iowait that is not a number', () => {
    expect(readNodeStatus({ wait: 'high' }).iowait).toBeUndefined()
    expect(readNodeStatus({ wait: 0 }).iowait).toBe(0)
  })

  it('treats an empty version or kernel string as absent', () => {
    const facts = readNodeStatus({ pveversion: '', 'current-kernel': { release: '' } })
    expect(facts.pveVersion).toBeUndefined()
    expect(facts.kernel).toBeUndefined()
  })
})

/** Shape of `/cluster/resources?type=storage`, as PVE 9 returns it. */
const STORAGE_ROWS = [
  {
    id: 'storage/pve1/local', storage: 'local', node: 'pve1', type: 'storage',
    plugintype: 'dir', status: 'available', shared: 0,
    disk: 22404694016, maxdisk: 26820993024, content: 'iso,vztmpl,backup',
  },
  {
    id: 'storage/pve1/CephStoragePool', storage: 'CephStoragePool', node: 'pve1', type: 'storage',
    plugintype: 'rbd', status: 'available', shared: 1,
    disk: 13123162752, maxdisk: 100310741632, content: 'rootdir,images',
  },
]

describe('readStorageResources', () => {
  /**
   * Two fields are not what their name suggests: the space figures arrive as
   * `disk` and `maxdisk`, and the plugin name is `plugintype` while `type`
   * carries the resource kind, which is the constant string "storage".
   */
  it('reads disk and maxdisk as used and total, and plugintype as the type', () => {
    const [local] = readStorageResources(STORAGE_ROWS, 'pve-1', 'PVE One')
    expect(local).toMatchObject({
      connId: 'pve-1', connName: 'PVE One', node: 'pve1', storage: 'local',
      type: 'dir', used: 22404694016, total: 26820993024, enabled: true,
    })
    expect(local.type).not.toBe('storage')
  })

  it('carries the shared flag through untouched, for aggregateStorage to collapse on', () => {
    const rows = readStorageResources(STORAGE_ROWS, 'pve-1', 'PVE One')
    expect(rows.map(r => r.shared)).toEqual([0, 1])
  })

  it('splits the content list', () => {
    const [local] = readStorageResources(STORAGE_ROWS, 'pve-1', 'PVE One')
    expect(local.content).toEqual(['iso', 'vztmpl', 'backup'])
  })

  /**
   * `unknown` is what Proxmox reports for a storage it could not reach, which
   * is not the same as one an operator disabled. Both mean the same thing to
   * a capacity plan, so both are reported as not enabled.
   */
  it('treats an unreachable storage as not enabled, like a disabled one', () => {
    const rows = readStorageResources(
      [{ storage: 'a', status: 'unknown' }, { storage: 'b', status: 'disabled' },
       { storage: 'c', status: 'available' }],
      'pve-1', 'PVE One')
    expect(rows.map(r => r.enabled)).toEqual([false, false, true])
  })

  it('drops a row with no storage name rather than emitting a nameless entry', () => {
    expect(readStorageResources([{ node: 'pve1' }, ...STORAGE_ROWS], 'pve-1', 'PVE One'))
      .toHaveLength(2)
  })

  it('answers an empty list for anything that is not an array', () => {
    for (const payload of [null, undefined, {}, 'nope']) {
      expect(readStorageResources(payload, 'pve-1', 'PVE One')).toEqual([])
    }
  })

  it('defaults a missing capacity to 0 rather than NaN', () => {
    const [row] = readStorageResources([{ storage: 'a' }], 'pve-1', 'PVE One')
    expect(row.used).toBe(0)
    expect(row.total).toBe(0)
    expect(row.node).toBe('')
  })
})
