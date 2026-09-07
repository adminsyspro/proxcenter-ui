import { expect, it } from 'vitest'

import { snapshotIdentity, snapshotKey } from './snapshotIdentity'

const snapshot = { cluster_id: 'cluster', storage_engine: 'zfs' as const, node: 'n1', pool: 'rpool/data', image: 'vm-100-disk-0', snapshot: 'mirror-1' }

it('normalizes legacy RBD identity without a node', () => {
  const { storage_engine: _engine, node: _node, ...legacy } = snapshot
  expect(snapshotIdentity(legacy)).toEqual({ ...legacy, storage_engine: 'rbd', node: '' })
  expect(snapshotKey(legacy)).toBe(snapshotKey({ ...legacy, storage_engine: 'rbd', node: 'ignored' }))
  expect(snapshotIdentity({ ...snapshot, node: undefined }).node).toBe('')
})

it('includes every identity component without delimiter collisions', () => {
  const keys = [snapshotKey(snapshot), ...Object.keys(snapshot).map(field => snapshotKey({ ...snapshot, [field]: 'different' }))]
  expect(new Set(keys).size).toBe(7)
  expect(snapshotKey({ ...snapshot, pool: 'a::b', image: 'c' })).not.toBe(snapshotKey({ ...snapshot, pool: 'a', image: 'b::c' }))
})
