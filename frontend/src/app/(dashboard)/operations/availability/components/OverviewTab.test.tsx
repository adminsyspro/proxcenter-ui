import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent, within } from '@/__tests__/setup/renderWithProviders'

import type { OverviewResponse } from '../hooks/useAvailabilityOverview'

import { makeResult } from './fixtures'
import OverviewTab from './OverviewTab'

const { hookMock } = vi.hoisted(() => ({ hookMock: vi.fn() }))

vi.mock('../hooks/useAvailabilityOverview', () => ({ useAvailabilityOverview: (...a: any[]) => hookMock(...a) }))

function overview(): OverviewResponse {
  const a1 = makeResult('pve1', ['up', 'down', 'up'], { availability: 66.6, coverage: 100 })
  const a2 = makeResult('pve2', ['up', 'up', 'up'])
  const b1 = { ...makeResult('pb1', ['unobserved', 'up']), ref: { connection_id: 'c2', kind: 'node' as const, node: 'pb1' }, availability: null, coverage: null }

  return {
    period: '24h',
    from: '2026-10-27T10:00:00.000Z',
    to: '2026-10-27T10:03:00.000Z',
    connections: [
      { id: 'c1', name: 'Paris', cluster: null, nodes: [a1, a2], summary: { up_seconds: 0, down_seconds: 0, unobserved_seconds: 0, availability: 90, coverage: 100, below_target: 0, budget: null } },
      { id: 'c2', name: 'Lyon', cluster: null, nodes: [b1], summary: { up_seconds: 0, down_seconds: 0, unobserved_seconds: 0, availability: null, coverage: null, below_target: 0, budget: null } },
    ],
    current: {
      states: [
        { ref: a1.ref, state: 'down' },
        { ref: a2.ref, state: 'up' },
        { ref: b1.ref, state: 'maintenance' },
      ],
      collectedAt: {},
    },
    tiles: { nodesUp: 1, nodesTotal: 3, clustersQuorate: 0, clustersTotal: 0, nodesMaintenance: 1, coveredGuestsDown: null, coverage: 80 },
  }
}

beforeEach(() => {
  hookMock.mockReset().mockReturnValue({ data: overview(), error: undefined, isLoading: false })
})

afterEach(cleanup)

describe('OverviewTab', () => {
  it('scrolls to the card of the URL hash once, after the data is there', () => {
    const scroll = vi.fn()

    Element.prototype.scrollIntoView = scroll
    window.location.hash = '#conn-c2'

    const { rerender } = renderWithProviders(<OverviewTab />)

    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ block: 'start' })
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('conn-c2'))
    // The linked card opens on its hosts, the others stay folded.
    expect(screen.getByRole('button', { name: 'Hosts of Lyon' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Hosts of Paris' })).toHaveAttribute('aria-expanded', 'false')
    hookMock.mockReturnValue({ data: overview(), error: undefined, isLoading: false })
    rerender(<OverviewTab />)
    expect(scroll).toHaveBeenCalledTimes(1)
    window.location.hash = ''
  })

  it('waits for the data before scrolling to the anchor', () => {
    const scroll = vi.fn()

    Element.prototype.scrollIntoView = scroll
    window.location.hash = '#conn-c2'
    hookMock.mockReturnValue({ data: undefined, error: undefined, isLoading: true })
    renderWithProviders(<OverviewTab />)

    expect(scroll).not.toHaveBeenCalled()
    window.location.hash = ''
  })

  it('shows the error banner and no numeric tile on a 503', () => {
    hookMock.mockReturnValue({ data: undefined, error: new Error('API error: 503'), isLoading: false })

    renderWithProviders(<OverviewTab />)

    expect(screen.getByRole('alert')).toHaveTextContent('The orchestrator is unreachable')
    expect(screen.queryByText('Nodes up')).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it.each([
    [403, 'You do not have access to the availability data.'],
    [500, 'Availability could not be loaded.'],
  ])('tells a %s apart from an unreachable orchestrator', (status, text) => {
    hookMock.mockReturnValue({ data: undefined, error: new Error(`API error: ${status}`), isLoading: false })

    renderWithProviders(<OverviewTab />)

    expect(screen.getByRole('alert')).toHaveTextContent(text)
    expect(screen.queryByText('Nodes up')).not.toBeInTheDocument()
  })

  it('shows not measured, not 0%, for a null coverage', async () => {
    renderWithProviders(<OverviewTab />)

    const lyon = screen.getByRole('region', { name: 'Lyon' })

    await userEvent.click(within(lyon).getByRole('button', { name: 'Hosts of Lyon' }))
    expect(within(lyon).getAllByText('Not measured').length).toBeGreaterThanOrEqual(2)
    expect(within(lyon).queryByText('0%')).not.toBeInTheDocument()
  })

  it('tells the period under the pointer of a node row', async () => {
    renderWithProviders(<OverviewTab />)

    const paris = screen.getByRole('region', { name: 'Paris' })

    await userEvent.click(within(paris).getByRole('button', { name: 'Hosts of Paris' }))

    const bar = within(paris).getAllByRole('img')[0]

    await userEvent.hover(bar.querySelector('[data-state="down"]') as HTMLElement)

    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Down · .* · 1mClick for the detail$/)
    expect(screen.queryByRole('region', { name: 'Slot detail' })).not.toBeInTheDocument()
  })

  it('filters the cards with the tiles', async () => {
    renderWithProviders(<OverviewTab />)

    await userEvent.click(screen.getByRole('button', { name: /Nodes down/ }))

    expect(screen.getByRole('region', { name: 'Paris' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Lyon' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /In maintenance/ }))

    expect(screen.queryByRole('region', { name: 'Paris' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Lyon' })).toBeInTheDocument()
  })

  it('opens on 24h and asks for the selected period', async () => {
    renderWithProviders(<OverviewTab />)

    expect(hookMock).toHaveBeenLastCalledWith('24h')
    await userEvent.click(screen.getByRole('button', { name: '7d' }))

    expect(hookMock).toHaveBeenLastCalledWith('7d')
  })

  it('folds every card by default, and opens or folds them all at once', async () => {
    renderWithProviders(<OverviewTab />)

    const toggles = () => ['Paris', 'Lyon'].map(n => screen.getByRole('button', { name: `Hosts of ${n}` }).getAttribute('aria-expanded'))

    expect(toggles()).toEqual(['false', 'false'])
    expect(screen.queryByText('Availability per host')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(toggles()).toEqual(['true', 'true'])
    expect(screen.getAllByText('Availability per host')).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Hosts of Paris' }))
    expect(toggles()).toEqual(['false', 'true'])

    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(toggles()).toEqual(['false', 'false'])
  })

  it('explains an empty page when no connection is measured, with the button that opens the configuration', async () => {
    const onConfigure = vi.fn()
    hookMock.mockReturnValue({ data: { ...overview(), connections: [], unmeasured: 2, canConfigure: true }, error: undefined, isLoading: false })
    renderWithProviders(<OverviewTab onConfigure={onConfigure} />)

    expect(screen.getByText(/^No connection is measured yet/)).toBeInTheDocument()
    expect(screen.queryByText('No connection to show')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Choose the measured connections' }))
    expect(onConfigure).toHaveBeenCalledTimes(1)
  })

  it('names how many connections are left out, without a button for whoever may not change them', () => {
    hookMock.mockReturnValue({ data: { ...overview(), unmeasured: 3, canConfigure: false }, error: undefined, isLoading: false })
    renderWithProviders(<OverviewTab onConfigure={vi.fn()} />)

    expect(screen.getByText(/3 connections are not measured\./)).toBeInTheDocument()
    expect(screen.getByText(/An administrator chooses them/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose the measured connections' })).not.toBeInTheDocument()
  })
})
