import { useState } from 'react'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import type { ClusterCapacity, NodeCapacity, ResourceThresholds } from '../../types'
import { DEFAULT_ASSUMPTIONS, type PlanningAssumptions, type Scenario } from '../../algorithms/capacityPlanning'
import CapacitySimulator from './CapacitySimulator'

afterEach(cleanup)

const GiB = 1024 ** 3

const thresholds: ResourceThresholds = {
  cpu: { warning: 70, critical: 90 },
  ram: { warning: 80, critical: 90 },
  storage: { warning: 80, critical: 90 },
}

function cluster(id: string, name: string): ClusterCapacity {
  return {
    id,
    name,
    nodesOnline: 2,
    nodesTotal: 2,
    cpu: { cores: 20, usedPct: 20, vcpuAllocated: 40, ratio: 2 },
    ram: { total: 200 * GiB, used: 80 * GiB, usedPct: 40, allocated: 120 * GiB, ratio: 0.6 },
    storage: { used: 0, total: 0, pct: 0 },
    guests: { running: 10, stopped: 0, templates: 0 },
    nPlusOne: { applicable: true, largestNode: 'pve1', cpuPctAfter: 40, ramPctAfter: 80, ok: true },
    imbalance: { cpu: 0, ram: 0 },
    trends: [],
  }
}

function node(overrides: Partial<NodeCapacity>): NodeCapacity {
  return {
    key: 'c1:pve1',
    connectionId: 'c1',
    connectionName: 'Prod',
    node: 'pve1',
    online: true,
    cores: 10,
    cpuPct: 20,
    memTotal: 100 * GiB,
    memUsed: 40 * GiB,
    ramPct: 40,
    vcpuAllocated: 20,
    ramAllocated: 60 * GiB,
    guestsRunning: 5,
    guestsTotal: 5,
    ...overrides,
  }
}

const clusters = [cluster('c1', 'Prod'), cluster('c2', 'Lab')]

// Prod: two identical nodes, 20 cores at 20 %, 200 GiB with 80 GiB used, 40 vCPU.
// Lab: one node, 8 cores at 50 %, 32 GiB with 16 GiB used, 16 vCPU.
const nodes = [
  node({}),
  node({ key: 'c1:pve2', node: 'pve2' }),
  node({ key: 'c1:pve3', node: 'pve3', online: false, memTotal: 512 * GiB, cores: 64 }),
  node({ key: 'c2:lab1', connectionId: 'c2', connectionName: 'Lab', node: 'lab1', cores: 8, cpuPct: 50, memTotal: 32 * GiB, memUsed: 16 * GiB, vcpuAllocated: 16 }),
]

type Props = React.ComponentProps<typeof CapacitySimulator>

function renderSimulator(overrides: Partial<Props> = {}) {
  const onAssumptionsChange = vi.fn<(next: PlanningAssumptions) => void>()

  renderWithProviders(
    <CapacitySimulator clusters={clusters} nodes={nodes} thresholds={thresholds} assumptions={DEFAULT_ASSUMPTIONS} onAssumptionsChange={onAssumptionsChange} {...overrides} />,
  )

  return { onAssumptionsChange }
}

/** The result column ("Today" or "After the scenario"), found by its title. */
function column(title: string) {
  const box = screen.getByText(title).parentElement?.parentElement
  if (!box) throw new Error(`no column ${title}`)

  return within(box)
}

/** Headroom figure of a result column (the value next to "VMs that still fit"). */
function headroomOf(title: string): string | null {
  return column(title).getByText('VMs that still fit').nextElementSibling?.textContent ?? null
}

function pickOption(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }))
}

describe('CapacitySimulator results', () => {
  it('compares today with 10 more VMs of the template on the first cluster by default', () => {
    renderSimulator()

    expect(screen.getByText('What-if simulator')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Cluster' })).toHaveTextContent('Prod')

    const today = column('Today')
    expect(today.getByText('Fits')).toBeInTheDocument()
    expect(today.getByText('40%')).toBeInTheDocument()
    expect(today.getByText('20%')).toBeInTheDocument()
    expect(today.getByText('2.0:1')).toBeInTheDocument()
    expect(headroomOf('Today')).toBe('10')

    const after = column('After the scenario')
    expect(after.getByText('Fits')).toBeInTheDocument()
    expect(after.getByText('80%')).toBeInTheDocument()
    expect(after.getByText('40%')).toBeInTheDocument()
    expect(after.getByText('4.0:1')).toBeInTheDocument()
    expect(headroomOf('After the scenario')).toBe('0')
  })

  it('goes over the threshold once the largest node is lost', () => {
    renderSimulator()

    const lose = screen.getByLabelText('Lose the largest node')
    expect(lose).not.toBeChecked()

    fireEvent.click(lose)

    expect(lose).toBeChecked()
    const after = column('After the scenario')
    expect(after.getByText('Over threshold')).toBeInTheDocument()
    expect(after.getByText('160%')).toBeInTheDocument()
    expect(after.getByText('80%')).toBeInTheDocument()
    expect(after.getByText('8.0:1')).toBeInTheDocument()
    expect(column('Today').getByText('Fits')).toBeInTheDocument()
  })

  it('adds nodes copied from the largest online one', () => {
    renderSimulator()

    fireEvent.change(screen.getByLabelText('Nodes to add'), { target: { value: '1' } })

    const after = column('After the scenario')
    expect(after.getByText('53%')).toBeInTheDocument()
    expect(after.getByText('27%')).toBeInTheDocument()
    expect(after.getByText('2.7:1')).toBeInTheDocument()
    expect(headroomOf('After the scenario')).toBe('10')
  })

  it('matches today once no VM is added, and caps the VM count', () => {
    renderSimulator()

    const addVms = screen.getByLabelText('VMs to add')
    fireEvent.change(addVms, { target: { value: '0' } })

    expect(column('After the scenario').getByText('2.0:1')).toBeInTheDocument()
    expect(headroomOf('After the scenario')).toBe('10')

    fireEvent.change(addVms, { target: { value: '20000' } })
    // 10000 VMs of 4 vCPU on 20 cores: the cap, not the typed 20000.
    expect(column('After the scenario').getByText('2002.0:1')).toBeInTheDocument()
    expect(column('After the scenario').getByText('Over threshold')).toBeInTheDocument()
  })

  it('switches the scope to another cluster', () => {
    renderSimulator()

    pickOption('Cluster', 'Lab')

    expect(screen.getByRole('combobox', { name: 'Cluster' })).toHaveTextContent('Lab')
    const today = column('Today')
    expect(today.getAllByText('50%')).toHaveLength(2)
    expect(headroomOf('Today')).toBe('1')
  })

  it('opens on the initial cluster and scenario it is given', () => {
    const scenario: Scenario = { addVms: 5, loseLargestNode: true, addNodes: 0 }
    renderSimulator({ initialClusterId: 'c1', initialScenario: scenario })

    expect(screen.getByLabelText('Lose the largest node')).toBeChecked()
    expect(screen.getByLabelText('VMs to add')).toHaveValue(5)
    // 120 GiB used on the 100 GiB left once a node is gone.
    expect(column('After the scenario').getByText('120%')).toBeInTheDocument()
    expect(column('After the scenario').getByText('Over threshold')).toBeInTheDocument()
  })

  it('falls back to the first cluster when the initial one is unknown', () => {
    renderSimulator({ initialClusterId: 'gone' })

    expect(screen.getByRole('combobox', { name: 'Cluster' })).toHaveTextContent('Prod')
  })

  it('keeps a lone node when asked to lose the largest one', () => {
    renderSimulator({ initialClusterId: 'c2', initialScenario: { addVms: 0, loseLargestNode: true, addNodes: 0 } })

    expect(column('After the scenario').getAllByText('50%')).toHaveLength(2)
  })
})

describe('CapacitySimulator assumptions', () => {
  it('shows the preset matching the template and applies a picked preset', () => {
    const { onAssumptionsChange } = renderSimulator()

    expect(screen.getByRole('combobox', { name: 'Size' })).toHaveTextContent('M: 4 vCPU / 8 GB')

    pickOption('Size', 'L: 8 vCPU / 16 GB')

    expect(onAssumptionsChange).toHaveBeenCalledWith({ template: { vcpu: 8, ramGiB: 16 }, maxVcpuRatio: 4 })
  })

  it('shows a custom template as Custom and ignores picking Custom', () => {
    const { onAssumptionsChange } = renderSimulator({ assumptions: { template: { vcpu: 3, ramGiB: 6 }, maxVcpuRatio: 4 } })

    expect(screen.getByRole('combobox', { name: 'Size' })).toHaveTextContent('Custom')

    pickOption('Size', 'Custom')

    expect(onAssumptionsChange).not.toHaveBeenCalled()
  })

  it('clamps the template vCPU and RAM typed in', () => {
    const { onAssumptionsChange } = renderSimulator()

    fireEvent.change(screen.getByLabelText('vCPU'), { target: { value: '600' } })
    expect(onAssumptionsChange).toHaveBeenLastCalledWith({ template: { vcpu: 512, ramGiB: 8 }, maxVcpuRatio: 4 })

    fireEvent.change(screen.getByLabelText('RAM (GB)'), { target: { value: '0' } })
    expect(onAssumptionsChange).toHaveBeenLastCalledWith({ template: { vcpu: 4, ramGiB: 1 }, maxVcpuRatio: 4 })
  })

  it('accepts a decimal vCPU ratio and caps it at 64', () => {
    const { onAssumptionsChange } = renderSimulator()
    const ratio = screen.getByLabelText('Accepted vCPU:pCPU ratio')

    fireEvent.change(ratio, { target: { value: '2.5' } })
    expect(onAssumptionsChange).toHaveBeenLastCalledWith({ template: { vcpu: 4, ramGiB: 8 }, maxVcpuRatio: 2.5 })

    fireEvent.change(ratio, { target: { value: '100' } })
    expect(onAssumptionsChange).toHaveBeenLastCalledWith({ template: { vcpu: 4, ramGiB: 8 }, maxVcpuRatio: 64 })
  })

  it('recomputes the headroom with the assumptions the parent keeps', () => {
    function Harness() {
      const [assumptions, setAssumptions] = useState<PlanningAssumptions>(DEFAULT_ASSUMPTIONS)

      return <CapacitySimulator clusters={clusters} nodes={nodes} thresholds={thresholds} assumptions={assumptions} onAssumptionsChange={setAssumptions} />
    }

    renderWithProviders(<Harness />)
    expect(headroomOf('Today')).toBe('10')

    pickOption('Size', 'XL: 16 vCPU / 64 GB')

    // 80 GiB of RAM room for 64 GiB VMs, 40 vCPU of room for 16 vCPU VMs.
    expect(headroomOf('Today')).toBe('1')
    expect(screen.getByLabelText('vCPU')).toHaveValue(16)
  })
})
