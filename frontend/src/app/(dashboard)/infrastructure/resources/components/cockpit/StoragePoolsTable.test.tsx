import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import type { NodeCapacity, StoragePool } from '../../types'
import { DEFAULT_THRESHOLDS } from '../../constants'
import StoragePoolsTable from './StoragePoolsTable'

afterEach(cleanup)

const GiB = 1024 ** 3

function pool(key: string, over: Partial<StoragePool> = {}): StoragePool {
  return {
    key,
    name: key,
    type: 'rbd',
    shared: true,
    connectionId: 'c1',
    connectionName: 'prod',
    node: null,
    used: 400 * GiB,
    total: 1000 * GiB,
    pct: 40,
    growthPctPerDay: 0.1,
    daysToThreshold: 120,
    ...over,
  }
}

function node(name: string, online: boolean): NodeCapacity {
  return {
    key: `c1:${name}`,
    connectionId: 'c1',
    connectionName: 'prod',
    node: name,
    online,
    cores: 16,
    cpuPct: 0,
    memTotal: 64 * GiB,
    memUsed: 0,
    ramPct: 0,
    vcpuAllocated: 0,
    ramAllocated: 0,
    guestsRunning: 0,
    guestsTotal: 0,
  }
}

const rowOf = (name: string) => within(screen.getByText(name).closest('tr') as HTMLTableRowElement)

describe('StoragePoolsTable', () => {
  it('shows scope, type, usage, capacity, growth and runway of each pool', () => {
    const pools = [
      pool('ceph'),
      pool('local-lvm', { type: 'lvmthin', shared: false, node: 'pve1', pct: 92, used: 920 * GiB, growthPctPerDay: null, daysToThreshold: 0 }),
      pool('local-zfs', { type: 'zfspool', shared: false, node: 'pve2', growthPctPerDay: 0, daysToThreshold: null }),
    ]

    const { container } = renderWithProviders(
      <StoragePoolsTable pools={pools} nodes={[node('pve1', true), node('pve2', false)]} thresholds={DEFAULT_THRESHOLDS} showClusters={false} />,
    )

    expect(screen.queryByRole('columnheader', { name: 'Cluster' })).toBeNull()

    const ceph = rowOf('ceph')

    expect(ceph.getByText('Shared')).toBeInTheDocument()
    expect(ceph.getByText('rbd')).toBeInTheDocument()
    expect(ceph.getByText('40%')).toBeInTheDocument()
    expect(ceph.getByText('400 GB / 1000 GB')).toBeInTheDocument()
    expect(ceph.getByText('3.0 pts / 30 d')).toBeInTheDocument()
    expect(ceph.getByText('120 d')).toBeInTheDocument()

    const lvm = rowOf('local-lvm')

    expect(lvm.getByText('pve1')).toBeInTheDocument()
    expect(lvm.getByText('92%')).toBeInTheDocument()
    expect(lvm.getByText('-')).toBeInTheDocument()
    expect(lvm.getByText('Exceeded')).toBeInTheDocument()

    const zfs = rowOf('local-zfs')

    expect(zfs.getByText('pve2')).toBeInTheDocument()
    expect(zfs.getByText('0.0 pts / 30 d')).toBeInTheDocument()
    expect(zfs.getByText('> 1 year')).toBeInTheDocument()

    expect(container.querySelectorAll('.ri-share-line')).toHaveLength(1)
    expect(container.querySelectorAll('.ri-hard-drive-2-line')).toHaveLength(2)
  })

  it('adds the cluster column across clusters', () => {
    renderWithProviders(<StoragePoolsTable pools={[pool('ceph', { connectionName: 'dr-site' })]} nodes={[]} thresholds={DEFAULT_THRESHOLDS} showClusters />)

    expect(screen.getByRole('columnheader', { name: 'Cluster' })).toBeInTheDocument()
    expect(rowOf('ceph').getByText('dr-site')).toBeInTheDocument()
  })

  it('says when no storage is reported', () => {
    renderWithProviders(<StoragePoolsTable pools={[]} nodes={[]} thresholds={DEFAULT_THRESHOLDS} showClusters={false} />)

    expect(screen.getByText('No storage reported')).toBeInTheDocument()
  })

  it('turns to the page of the pool a "To handle" item points at', () => {
    const pools = Array.from({ length: 30 }, (_, i) => pool(`pool-${String(i + 1).padStart(2, '0')}`))
    const props = { pools, nodes: [], thresholds: DEFAULT_THRESHOLDS, showClusters: false }
    const { rerender } = renderWithProviders(<StoragePoolsTable {...props} />)

    expect(screen.queryByText('pool-27')).toBeNull()

    rerender(<StoragePoolsTable {...props} focus={{ key: 'pool-27', nonce: 1 }} />)
    expect(screen.getByText('pool-27')).toBeInTheDocument()
    expect(screen.queryByText('pool-01')).toBeNull()
  })
})
