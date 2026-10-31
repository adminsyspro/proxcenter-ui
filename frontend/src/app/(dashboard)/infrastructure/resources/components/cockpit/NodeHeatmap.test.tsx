import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import type { NodeCapacity } from '../../types'
import { DEFAULT_THRESHOLDS } from '../../constants'
import NodeHeatmap from './NodeHeatmap'

afterEach(cleanup)

const GiB = 1024 ** 3

function node(connectionId: string, connectionName: string, name: string, over: Partial<NodeCapacity> = {}): NodeCapacity {
  return {
    key: `${connectionId}:${name}`,
    connectionId,
    connectionName,
    node: name,
    online: true,
    cores: 16,
    cpuPct: 30,
    memTotal: 128 * GiB,
    memUsed: 64 * GiB,
    ramPct: 50,
    vcpuAllocated: 40,
    ramAllocated: 96 * GiB,
    guestsRunning: 10,
    guestsTotal: 12,
    ...over,
  }
}

const rowOf = (name: string) => within(screen.getByText(name).closest('tr') as HTMLTableRowElement)
const nodeNames = () => screen.getAllByRole('row').slice(1).map(r => r.textContent ?? '')

describe('NodeHeatmap', () => {
  it('shows the load, overcommit, allocated RAM and guests of each node', () => {
    const nodes = [
      node('c1', 'prod', 'pve1', { cpuPct: 72, ramPct: 85 }),
      node('c1', 'prod', 'pve2', { online: false, cores: 0, guestsRunning: 0 }),
    ]

    renderWithProviders(<NodeHeatmap nodes={nodes} thresholds={DEFAULT_THRESHOLDS} showClusters={false} />)

    const up = rowOf('pve1')

    expect(up.getByText('72%')).toBeInTheDocument()
    expect(up.getByText('85%')).toBeInTheDocument()
    expect(up.getByText('2.5:1')).toBeInTheDocument()
    expect(up.getByText('96 GB / 128 GB')).toBeInTheDocument()
    expect(up.getByText('10/12')).toBeInTheDocument()

    // An offline node has no load, and no cores to divide by.
    const down = rowOf('pve2')

    expect(down.getAllByText('-')).toHaveLength(3)
    expect(down.getByText('0/12')).toBeInTheDocument()

    // No cluster header rows on a single-cluster view.
    expect(screen.queryByText('prod')).toBeNull()
  })

  it('groups nodes under their cluster, sorted by cluster then by node number', () => {
    const nodes = [
      node('c2', 'zeta', 'z1'),
      node('c1', 'alpha', 'pve10'),
      node('c1', 'alpha', 'pve2'),
    ]

    renderWithProviders(<NodeHeatmap nodes={nodes} thresholds={DEFAULT_THRESHOLDS} showClusters />)

    const rows = nodeNames()

    expect(rows[0]).toBe('alpha')
    expect(rows[1]).toMatch(/^pve2/)
    expect(rows[2]).toMatch(/^pve10/)
    expect(rows[3]).toBe('zeta')
    expect(rows[4]).toMatch(/^z1/)
  })

  it('says when there is no node data', () => {
    renderWithProviders(<NodeHeatmap nodes={[]} thresholds={DEFAULT_THRESHOLDS} showClusters={false} />)

    expect(screen.getByText('No node data available')).toBeInTheDocument()
  })

  it('turns to the page of the first node of a focused cluster', () => {
    const nodes = [
      ...Array.from({ length: 22 }, (_, i) => node('c1', 'alpha', `a${String(i + 1).padStart(2, '0')}`)),
      node('c2', 'beta', 'b01'),
      node('c2', 'beta', 'b02'),
    ]
    const props = { nodes, thresholds: DEFAULT_THRESHOLDS, showClusters: false }
    const { rerender } = renderWithProviders(<NodeHeatmap {...props} />)

    expect(screen.queryByText('b01')).toBeNull()

    rerender(<NodeHeatmap {...props} focus={{ key: 'c2', nonce: 1 }} />)
    expect(screen.getByText('b01')).toBeInTheDocument()
    expect(screen.getByText('b02')).toBeInTheDocument()
    expect(screen.queryByText('a01')).toBeNull()

    // A node key focuses that one node.
    rerender(<NodeHeatmap {...props} focus={{ key: 'c1:a03', nonce: 2 }} />)
    expect(screen.getByText('a03')).toBeInTheDocument()
  })
})
