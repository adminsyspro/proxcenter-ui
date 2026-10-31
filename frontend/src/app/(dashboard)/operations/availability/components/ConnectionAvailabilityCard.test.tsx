import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent, within } from '@/__tests__/setup/renderWithProviders'

import type { ConnectionOverview } from '../hooks/useAvailabilityOverview'

import ConnectionAvailabilityCard from './ConnectionAvailabilityCard'
import { makeResult } from './fixtures'

const { rateSpy } = vi.hoisted(() => ({ rateSpy: vi.fn() }))

// Each row render formats its rate: counting the calls with a value only that
// row carries counts that row's renders.
vi.mock('./availabilityFormat', async importOriginal => {
  const actual = await importOriginal<typeof import('./availabilityFormat')>()

  return {
    ...actual,
    useAvailabilityFormat: () => {
      const f = actual.useAvailabilityFormat()

      return { ...f, rate: (v: number) => { rateSpy(v); return f.rate(v) } }
    },
  }
})

const connection: ConnectionOverview = {
  id: 'c1',
  name: 'Paris',
  cluster: null,
  nodes: [
    makeResult('pve1', ['up', 'down', 'up'], { availability: 99.93 }),
    makeResult('pve2', ['up', 'up', 'up'], { availability: 71.5 }),
  ],
  summary: { up_seconds: 0, down_seconds: 0, unobserved_seconds: 0, availability: 90, coverage: 100, below_target: 0, budget: null },
}

const noop = () => {}

const calls = (value: number) => rateSpy.mock.calls.filter(c => c[0] === value).length

beforeEach(() => {
  rateSpy.mockReset()
})

afterEach(cleanup)

describe('ConnectionAvailabilityCard', () => {
  it('carries the conn-<id> anchor a link can land on', () => {
    renderWithProviders(<ConnectionAvailabilityCard connection={connection} to='2026-10-27T10:03:00.000Z' status='up' expanded onToggle={noop} />)

    expect(screen.getByRole('region', { name: 'Paris' })).toHaveAttribute('id', 'conn-c1')
  })

  it('leaves the cluster rate out when the connection has no cluster row', () => {
    renderWithProviders(<ConnectionAvailabilityCard connection={connection} to='2026-10-27T10:03:00.000Z' status='up' expanded onToggle={noop} />)

    expect(screen.queryByText('Cluster availability')).not.toBeInTheDocument()
  })

  it('shows the cluster rate when the connection has a cluster row', () => {
    const withCluster = { ...connection, cluster: makeResult('cluster', ['up', 'up', 'up'], { availability: null }) }

    renderWithProviders(<ConnectionAvailabilityCard connection={withCluster} to='2026-10-27T10:03:00.000Z' status='up' expanded onToggle={noop} />)

    expect(screen.getByText('Cluster availability')).toBeInTheDocument()
  })

  it('details the whole period the row stayed in the hovered state', async () => {
    const outage = { ...connection, nodes: [makeResult('pve9', ['up', 'down', 'down', 'down'], { availability: 25 })] }

    renderWithProviders(<ConnectionAvailabilityCard connection={outage} to='2026-10-27T10:04:00.000Z' status='up' expanded onToggle={noop} />)

    const [bar] = screen.getAllByRole('img')
    fireEvent.mouseMove(bar.querySelector('[data-i="2"]') as HTMLElement)

    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Down · .* · 3mClick for the detail$/)
  })

  it('re-renders only the hovered row, never the card or the other rows', async () => {
    renderWithProviders(<ConnectionAvailabilityCard connection={connection} to='2026-10-27T10:03:00.000Z' status='up' expanded onToggle={noop} />)

    const [first] = screen.getAllByRole('img')
    const otherRow = calls(71.5)
    const cardCalls = calls(90)

    fireEvent.mouseMove(first.querySelector('[data-i="1"]') as HTMLElement)

    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
    expect(calls(90)).toBe(cardCalls)
    expect(calls(71.5)).toBe(otherRow)
  })

  it('shows the time of the last sample, or that there is none', () => {
    const { rerender } = renderWithProviders(<ConnectionAvailabilityCard connection={connection} to='2026-10-27T10:03:00.000Z' status='up' expanded onToggle={noop} collectedAt='2026-10-27T10:00:00.000Z' />)

    expect(screen.getByText(/^Last sample: .*2026/)).toBeInTheDocument()

    rerender(<ConnectionAvailabilityCard connection={connection} to='2026-10-27T10:03:00.000Z' status='up' expanded onToggle={noop} />)

    expect(screen.getByText('Never sampled')).toBeInTheDocument()
  })

  it('folds to one summary row, down where any host was', async () => {
    const onToggle = vi.fn()
    const withCluster = { ...connection, cluster: makeResult('cluster', ['up', 'up', 'maintenance'], { availability: 100 }) }

    renderWithProviders(<ConnectionAvailabilityCard connection={withCluster} to='2026-10-27T10:03:00.000Z' status='up' expanded={false} onToggle={onToggle} />)

    const card = screen.getByRole('region', { name: 'Paris' })
    const [summary] = within(card).getAllByRole('img')

    expect(within(card).getAllByRole('img')).toHaveLength(1)
    expect(summary).toHaveAccessibleName('Overall · 2 hosts: 90% available, 1 outage')
    expect([...summary.querySelectorAll('span')].map(s => s.dataset.state)).toEqual(['up', 'down', 'maintenance'])
    expect(within(card).queryByText('Availability per host')).not.toBeInTheDocument()

    fireEvent.mouseMove(summary.querySelector('[data-i="1"]') as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Click to see each host$/)

    await userEvent.click(summary.querySelector('[data-i="1"]') as HTMLElement)
    expect(onToggle).toHaveBeenCalledWith('c1')
    expect(screen.queryByRole('region', { name: 'Detail of the period' })).not.toBeInTheDocument()

    const header = within(card).getByRole('button', { name: 'Hosts of Paris' })

    expect(header).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(header)
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('opens on the rates and a row per host', () => {
    renderWithProviders(<ConnectionAvailabilityCard connection={connection} to='2026-10-27T10:03:00.000Z' status='up' expanded onToggle={noop} />)

    const card = screen.getByRole('region', { name: 'Paris' })

    expect(within(card).getByRole('button', { name: 'Hosts of Paris' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(card).getAllByRole('img').map(i => i.getAttribute('aria-label'))).toEqual([
      'pve1: 99.93% available, 0 outages',
      'pve2: 71.5% available, 0 outages',
    ])
  })
})
