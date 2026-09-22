import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

afterEach(cleanup)

import RBACContext from '@/contexts/RBACContext'

import InventorySummary from './InventorySummary'

const GIB = 1024 ** 3

// A 32-thread, 128 GiB host, drawn from the same shape helpers.ts builds.
const HOST = {
  uptime: 86_400,
  cpuModel: '32 x AMD EPYC 7302P',
  cpuCores: 16,
  cpuSockets: 2,
  cpuTotal: 32,
}

const METRICS = {
  cpu: { label: 'CPU', pct: 42, used: 42, max: 100 },
  ram: { label: 'RAM', pct: 68, used: 87 * GIB, max: 128 * GIB },
}

const vm = (over: Record<string, unknown> = {}) => ({
  id: 'conn1:pve1:qemu:100',
  connId: 'conn1',
  node: 'pve1',
  vmid: 100,
  name: 'web',
  type: 'qemu' as const,
  status: 'running',
  maxcpu: 24,
  maxmem: 96 * GIB,
  ...over,
})

// Half the node's capacity running, the whole of it overcommitted at 1.5x.
const OVERCOMMITTED = [vm(), vm({ vmid: 101, status: 'stopped' })]

// `/cluster/resources` only returns the whole node's guests to an admin; every
// other user gets their permitted subset. The figures follow that same flag,
// so the tests have to state which user is looking.
function renderHost(nodeVms?: any[], rbac: Record<string, unknown> = { isAdmin: true, loading: false }) {
  return renderWithProviders(
    <RBACContext.Provider value={rbac as any}>
      <InventorySummary kindLabel="HOST" status="ok" hostInfo={HOST} metrics={METRICS as any} nodeVms={nodeVms as any} />
    </RBACContext.Provider>
  )
}

describe('InventorySummary provisioned resources (#969)', () => {
  it('puts the overcommit ratio on a chip beside each gauge label', () => {
    renderHost(OVERCOMMITTED)

    expect(screen.getAllByTestId('provisioning-chip')).toHaveLength(2)
    expect(screen.getAllByTestId('provisioning-chip')[0]).toHaveTextContent('1.5×')
  })

  it('flags the chip as an overcommit past capacity, and not below it', () => {
    renderHost(OVERCOMMITTED)
    expect(screen.getAllByTestId('provisioning-chip')[0]).toHaveAttribute('data-overcommitted', 'true')

    cleanup()
    renderHost([vm({ maxcpu: 4, maxmem: 8 * GIB })])
    expect(screen.getAllByTestId('provisioning-chip')[0]).toHaveAttribute('data-overcommitted', 'false')
  })

  it('adds no line under the gauges — the detail lives in the tooltip', () => {
    renderHost(OVERCOMMITTED)

    expect(screen.queryByText(/Provisioned:/)).not.toBeInTheDocument()
  })

  it('marks the chip with an icon, so a bare ratio is not mistaken for usage', () => {
    renderHost(OVERCOMMITTED)

    expect(screen.getAllByTestId('provisioning-chip')[0].querySelector('i.ri-stack-line')).toBeTruthy()
  })

  it('opens the same breakdown from the chip, the most obvious thing to hover', async () => {
    renderHost(OVERCOMMITTED)

    await userEvent.hover(screen.getAllByTestId('provisioning-chip')[0])

    const tip = await screen.findByRole('tooltip')

    expect(tip).toHaveTextContent('2 guests in total')
    expect(tip).toHaveTextContent('48 vCPU')
  })

  it('breaks the figures down on hovering the CPU marker', async () => {
    renderHost(OVERCOMMITTED)

    await userEvent.hover(screen.getAllByTestId('usage-bar-marker')[0])

    const tip = await screen.findByRole('tooltip')

    // Every figure has to name what it counts: the resource, the guests behind
    // it, what the ratio divides by, and the node's own capacity.
    expect(tip).toHaveTextContent('vCPU provisioned to guests')
    expect(tip).toHaveTextContent('1 running guest')
    expect(tip).toHaveTextContent('24 vCPU')
    expect(tip).toHaveTextContent('0.75× capacity')
    expect(tip).toHaveTextContent('2 guests in total')
    expect(tip).toHaveTextContent('48 vCPU')
    expect(tip).toHaveTextContent('1.5× capacity')
    expect(tip).toHaveTextContent('Node capacity: 32 logical CPUs')
  })

  it('names memory and its own capacity on the memory gauge', async () => {
    renderHost(OVERCOMMITTED)

    await userEvent.hover(screen.getAllByTestId('provisioning-chip')[1])

    const tip = await screen.findByRole('tooltip')

    expect(tip).toHaveTextContent('Memory provisioned to guests')
    expect(tip).toHaveTextContent('96 GiB')
    expect(tip).toHaveTextContent('Node capacity: 128 GiB')
  })

  it('marks the CPU and memory gauges at what the running guests hold', () => {
    renderHost(OVERCOMMITTED)

    const markers = screen.getAllByTestId('usage-bar-marker')

    expect(markers).toHaveLength(2)
    expect(markers[0]).toHaveStyle({ left: '75%' })
    expect(markers[1]).toHaveStyle({ left: '75%' })
  })

  it('flags the overflow when the running guests alone exceed the host', () => {
    renderHost([vm({ maxcpu: 48, maxmem: 192 * GIB })])

    expect(screen.getAllByTestId('usage-bar-marker')[0]).toHaveStyle({ left: '100%' })
    expect(screen.getAllByTestId('usage-bar-overflow')).toHaveLength(2)
  })

  it('excludes templates, which reserve nothing', () => {
    renderHost([vm(), vm({ vmid: 900, status: 'stopped', template: true, maxcpu: 64, maxmem: 512 * GIB })])

    expect(screen.getAllByTestId('provisioning-chip')[0]).toHaveTextContent('0.75×')
  })

  it('leaves the gauges exactly as they were on a node that holds no guest', () => {
    renderHost([])

    expect(screen.queryByTestId('usage-bar-marker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('provisioning-chip')).not.toBeInTheDocument()
  })

  it('leaves the gauges alone when the caller passes no guests at all', () => {
    renderHost(undefined)

    expect(screen.queryByTestId('usage-bar-marker')).not.toBeInTheDocument()
  })

  it('shows nothing to a scoped user, whose guest list is only their own share of the node', () => {
    // A tenant seeing 1 of the node's 20 guests would otherwise read "0.25×"
    // as the node's overcommit. Better no figure than a wrong one.
    renderHost(OVERCOMMITTED, { isAdmin: false, loading: false })

    expect(screen.queryByTestId('usage-bar-marker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('provisioning-chip')).not.toBeInTheDocument()
  })
})
