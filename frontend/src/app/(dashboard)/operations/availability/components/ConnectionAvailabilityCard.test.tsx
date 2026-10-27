import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

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

const calls = (value: number) => rateSpy.mock.calls.filter(c => c[0] === value).length

beforeEach(() => {
  rateSpy.mockReset()
})

afterEach(cleanup)

describe('ConnectionAvailabilityCard', () => {
  it('leaves the cluster rate out when the connection has no cluster row', () => {
    renderWithProviders(<ConnectionAvailabilityCard connection={connection} to='2026-10-27T10:03:00.000Z' status='up' />)

    expect(screen.queryByText('Cluster availability')).not.toBeInTheDocument()
  })

  it('shows the cluster rate when the connection has a cluster row', () => {
    const withCluster = { ...connection, cluster: makeResult('cluster', ['up', 'up', 'up'], { availability: null }) }

    renderWithProviders(<ConnectionAvailabilityCard connection={withCluster} to='2026-10-27T10:03:00.000Z' status='up' />)

    expect(screen.getByText('Cluster availability')).toBeInTheDocument()
  })

  it('details the whole period the row stayed in the hovered state', async () => {
    const outage = { ...connection, nodes: [makeResult('pve9', ['up', 'down', 'down', 'down'], { availability: 25 })] }

    renderWithProviders(<ConnectionAvailabilityCard connection={outage} to='2026-10-27T10:04:00.000Z' status='up' />)

    const [bar] = screen.getAllByRole('img')
    bar.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, right: 400, bottom: 20, height: 20, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.mouseMove(bar, { clientX: 250 })

    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Down · .* · 3m$/)
  })

  it('re-renders only the hovered row, never the card or the other rows', async () => {
    renderWithProviders(<ConnectionAvailabilityCard connection={connection} to='2026-10-27T10:03:00.000Z' status='up' />)

    const [first] = screen.getAllByRole('img')
    const otherRow = calls(71.5)
    const cardCalls = calls(90)

    first.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, right: 300, bottom: 20, height: 20, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.mouseMove(first, { clientX: 150 })

    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
    expect(calls(90)).toBe(cardCalls)
    expect(calls(71.5)).toBe(otherRow)
  })

  it('shows the time of the last sample, or that there is none', () => {
    const { rerender } = renderWithProviders(<ConnectionAvailabilityCard connection={connection} to='2026-10-27T10:03:00.000Z' status='up' collectedAt='2026-10-27T10:00:00.000Z' />)

    expect(screen.getByText(/^Last sample: .*2026/)).toBeInTheDocument()

    rerender(<ConnectionAvailabilityCard connection={connection} to='2026-10-27T10:03:00.000Z' status='up' />)

    expect(screen.getByText('Never sampled')).toBeInTheDocument()
  })
})
