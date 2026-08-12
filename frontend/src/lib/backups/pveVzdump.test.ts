import { describe, it, expect } from 'vitest'

import { parseVzdumpVolidTime, vzdumpBackupTypeFromVolid, resolveVzdumpScanTargets, VZDUMP_MAX_PAIRS } from './pveVzdump'

describe('parseVzdumpVolidTime', () => {
  it('extracts the timestamp encoded in a vzdump filename', () => {
    const t = parseVzdumpVolidTime('local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst')
    expect(t).not.toBeNull()
    expect(new Date(t! * 1000).toISOString()).toBe('2026-08-11T15:51:33.000Z')
  })

  it('returns null when the volid carries no date', () => {
    expect(parseVzdumpVolidTime('local:backup/whatever.vma.zst')).toBeNull()
  })
})

describe('vzdumpBackupTypeFromVolid', () => {
  it('maps qemu archives to vm', () => {
    expect(vzdumpBackupTypeFromVolid('local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst')).toBe('vm')
  })

  it('maps lxc archives to ct', () => {
    expect(vzdumpBackupTypeFromVolid('local:backup/vzdump-lxc-200-2026_08_11-15_51_33.tar.zst')).toBe('ct')
  })

  it('maps legacy openvz archives to ct', () => {
    expect(vzdumpBackupTypeFromVolid('local:backup/vzdump-openvz-200-2026_08_11-15_51_33.tar.lzo')).toBe('ct')
  })

  it('returns null for a non-vzdump volid', () => {
    expect(vzdumpBackupTypeFromVolid('local:iso/debian.iso')).toBeNull()
  })
})

const nodes = (...names: string[]) =>
  names.map(n => ({ type: 'node', node: n, status: 'online' }))

const storageRes = (storage: string, node: string, status = 'available') =>
  ({ type: 'storage', storage, node, status })

describe('resolveVzdumpScanTargets', () => {
  it('keeps only backup-capable storages that are not PBS', () => {
    const { targets } = resolveVzdumpScanTargets(
      [
        { storage: 'local', type: 'dir', content: 'backup,iso', shared: 0 },
        { storage: 'pbs-01', type: 'pbs', content: 'backup', shared: 1 },
        { storage: 'data', type: 'lvmthin', content: 'images', shared: 0 },
      ],
      [...nodes('node1'), storageRes('local', 'node1'), storageRes('pbs-01', 'node1'), storageRes('data', 'node1')],
    )
    expect(targets).toEqual([{ node: 'node1', storage: 'local' }])
  })

  it('queries a non-shared storage on every online node', () => {
    const { targets } = resolveVzdumpScanTargets(
      [{ storage: 'local', type: 'dir', content: 'backup', shared: 0 }],
      [...nodes('node1', 'node2'), storageRes('local', 'node1'), storageRes('local', 'node2')],
    )
    expect(targets).toEqual([
      { node: 'node1', storage: 'local' },
      { node: 'node2', storage: 'local' },
    ])
  })

  it('queries a shared storage only once', () => {
    const { targets } = resolveVzdumpScanTargets(
      [{ storage: 'nfs-bkp', type: 'nfs', content: 'backup', shared: 1 }],
      [...nodes('node1', 'node2'), storageRes('nfs-bkp', 'node1'), storageRes('nfs-bkp', 'node2')],
    )
    expect(targets).toEqual([{ node: 'node1', storage: 'nfs-bkp' }])
  })

  it('skips offline nodes', () => {
    const { targets } = resolveVzdumpScanTargets(
      [{ storage: 'local', type: 'dir', content: 'backup', shared: 0 }],
      [
        { type: 'node', node: 'node1', status: 'online' },
        { type: 'node', node: 'node2', status: 'offline' },
        storageRes('local', 'node1'),
        storageRes('local', 'node2'),
      ],
    )
    expect(targets).toEqual([{ node: 'node1', storage: 'local' }])
  })

  it('still scans a storage whose status is indeterminate', () => {
    // `status` derives from RRD stats and can stay unknown without meaning the
    // storage is absent — treat `available` as a positive signal, never a filter.
    const { targets } = resolveVzdumpScanTargets(
      [{ storage: 'local', type: 'dir', content: 'backup', shared: 0 }],
      [...nodes('node1'), storageRes('local', 'node1', 'unknown')],
    )
    expect(targets).toEqual([{ node: 'node1', storage: 'local' }])
  })

  it('puts the guest current node first and truncates past the hard cap', () => {
    const many = Array.from({ length: 40 }, (_, i) => `node${i + 1}`)
    const { targets, truncated } = resolveVzdumpScanTargets(
      [{ storage: 'local', type: 'dir', content: 'backup', shared: 0 }],
      [...nodes(...many), ...many.map(n => storageRes('local', n))],
      'node40',
    )
    expect(truncated).toBe(true)
    expect(targets).toHaveLength(VZDUMP_MAX_PAIRS)
    expect(targets[0]).toEqual({ node: 'node40', storage: 'local' })
  })
})
