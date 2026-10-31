import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import type { ClusterCapacity, NodeCapacity, PredictiveAlert } from '../../types'
import type { ClusterRunway } from '../../algorithms/capacityPlanning'
import { DEFAULT_THRESHOLDS } from '../../constants'
import ClusterCapacityTable from './ClusterCapacityTable'

afterEach(cleanup)

const GiB = 1024 ** 3

function cluster(id: string, over: Partial<ClusterCapacity> = {}): ClusterCapacity {
  return {
    id,
    name: `cluster-${id}`,
    nodesOnline: 3,
    nodesTotal: 3,
    cpu: { cores: 48, usedPct: 35, vcpuAllocated: 120, ratio: 2.5 },
    ram: { total: 384 * GiB, used: 200 * GiB, usedPct: 52, allocated: 300 * GiB, ratio: 0.8 },
    storage: { used: 4 * 1024 * GiB, total: 10 * 1024 * GiB, pct: 40 },
    guests: { running: 30, stopped: 5, templates: 2 },
    nPlusOne: { applicable: true, largestNode: 'pve1', cpuPctAfter: 52, ramPctAfter: 78, ok: true },
    imbalance: { cpu: 4, ram: 7 },
    trends: [],
    ...over,
  }
}

function node(connectionId: string, name: string, online = true): NodeCapacity {
  return {
    key: `${connectionId}:${name}`,
    connectionId,
    connectionName: `cluster-${connectionId}`,
    node: name,
    online,
    cores: 16,
    cpuPct: 30,
    memTotal: 128 * GiB,
    memUsed: 64 * GiB,
    ramPct: 50,
    vcpuAllocated: 40,
    ramAllocated: 100 * GiB,
    guestsRunning: 10,
    guestsTotal: 12,
  }
}

function alert(resource: PredictiveAlert['resource'], daysToThreshold: number | null): PredictiveAlert {
  return { resource, currentValue: 70, predictedValue: 85, daysToThreshold, threshold: 90, trend: 'up', severity: 'warning' }
}

function runway(clusterId: string, soonest: PredictiveAlert | null): ClusterRunway {
  return { clusterId, alerts: soonest ? [soonest] : [], soonest }
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLTableRowElement

describe('ClusterCapacityTable', () => {
  it('shows one row per cluster with nodes, overcommit, runway, N+1 and imbalance', () => {
    const clusters = [
      cluster('a'),
      cluster('b', { nodesOnline: 1, nodesTotal: 2, nPlusOne: { applicable: false, largestNode: null, cpuPctAfter: null, ramPctAfter: null, ok: null } }),
      cluster('c', { cpu: { cores: 8, usedPct: 95, vcpuAllocated: 40, ratio: 5 }, nPlusOne: { applicable: true, largestNode: 'big', cpuPctAfter: null, ramPctAfter: 120, ok: false } }),
    ]
    const runways = [runway('a', alert('ram', 21)), runway('c', alert('cpu', 0))]

    renderWithProviders(
      <ClusterCapacityTable clusters={clusters} nodes={[node('a', 'pve1'), node('b', 'pve2', false)]} runways={runways} thresholds={DEFAULT_THRESHOLDS} />,
    )

    const a = within(rowOf('cluster-a'))

    expect(a.getByText('3/3')).toBeInTheDocument()
    expect(a.getByText('2.5:1')).toBeInTheDocument()
    expect(a.getByText('21 d · RAM')).toBeInTheDocument()
    expect(a.getByText('Holds')).toBeInTheDocument()
    expect(a.getByText('7 pts')).toBeInTheDocument()
    expect(a.getByText('35%')).toBeInTheDocument()
    expect(a.getByText('52%')).toBeInTheDocument()
    expect(a.getByText('40%')).toBeInTheDocument()

    const b = within(rowOf('cluster-b'))

    expect(b.getByText('1/2')).toBeInTheDocument()
    expect(b.getByText('> 1 year')).toBeInTheDocument()
    expect(b.getByText('N/A')).toBeInTheDocument()

    const c = within(rowOf('cluster-c'))

    expect(c.getByText('5.0:1')).toBeInTheDocument()
    expect(c.getByText('Exceeded · CPU')).toBeInTheDocument()
    expect(c.getByText('At risk')).toBeInTheDocument()
  })

  it('explains the N+1 verdict on hover', async () => {
    const user = userEvent.setup()
    const atRisk = cluster('c', { nPlusOne: { applicable: true, largestNode: null, cpuPctAfter: null, ramPctAfter: 120, ok: false } })

    renderWithProviders(<ClusterCapacityTable clusters={[atRisk]} nodes={[]} runways={[]} thresholds={DEFAULT_THRESHOLDS} />)
    await user.hover(screen.getByText('At risk'))

    expect(await screen.findByText('Without : no capacity left on the remaining nodes')).toBeInTheDocument()
  })

  it('gives the load left on the other nodes when it can be computed', async () => {
    const user = userEvent.setup()
    const atRisk = cluster('c', { nPlusOne: { applicable: true, largestNode: 'pve1', cpuPctAfter: 60, ramPctAfter: 120, ok: false } })

    renderWithProviders(<ClusterCapacityTable clusters={[atRisk]} nodes={[]} runways={[]} thresholds={DEFAULT_THRESHOLDS} />)
    await user.hover(screen.getByText('At risk'))

    expect(await screen.findByText('Without pve1: RAM 120%, CPU 60% on the remaining nodes')).toBeInTheDocument()
  })

  it('says when no cluster is connected', () => {
    renderWithProviders(<ClusterCapacityTable clusters={[]} nodes={[]} runways={[]} thresholds={DEFAULT_THRESHOLDS} />)

    expect(screen.getByText('No Proxmox cluster connected')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('turns to the page of the cluster a "To handle" item points at', () => {
    const clusters = Array.from({ length: 25 }, (_, i) => cluster(String(i + 1).padStart(2, '0')))
    const props = { clusters, nodes: [], runways: [], thresholds: DEFAULT_THRESHOLDS }
    const { rerender } = renderWithProviders(<ClusterCapacityTable {...props} />)

    expect(screen.queryByText('cluster-23')).toBeNull()

    rerender(<ClusterCapacityTable {...props} focus={{ key: '23', nonce: 1 }} />)
    expect(screen.getByText('cluster-23')).toBeInTheDocument()
    expect(screen.queryByText('cluster-01')).toBeNull()
  })
})
