/**
 * FlowsTab in Zone mode (UA35): ?groupBy=zone turns the pairs into zones, adds the Traffic by zone strip and the
 * Micro-segmentation column; without an applied policy the Zone grouping stays disabled and the page stays as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/contexts/LicenseContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/contexts/LicenseContext')>()),
  useLicense: () => ({ hasFeature: () => true }),
}))

import FlowsTab from './FlowsTab'
import { PAIRS, POLICY, SUGGESTIONS, VMS, reply } from './lensTestKit'

const STATUS = { enabled: true, listen_address: '0.0.0.0:6343', agents: [], total_flows: 6, flow_rate: 1, active_vms: 3 }

let policy: unknown = POLICY
let pairs: unknown = PAIRS
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.startsWith('/api/v1/orchestrator/sflow/agents')) return reply(200, { data: [] })
  if (url.startsWith('/api/v1/orchestrator/sflow')) {
    const endpoint = new URLSearchParams(url.split('?')[1] ?? '').get('endpoint')
    if (endpoint === 'status') return reply(200, STATUS)
    if (endpoint === 'ip-pairs') return reply(200, pairs)
    return reply(200, [])
  }
  if (url === '/api/v1/connections?type=pve') return reply(200, { data: [{ id: 'c1', name: 'PROD' }] })
  if (url === '/api/v1/firewall/microseg/c1/policy') return reply(200, policy)
  if (url.startsWith('/api/v1/firewall/microseg/c1/suggestions')) return reply(200, { suggestions: SUGGESTIONS, limit: 200, offset: 0 })
  if (url === '/api/v1/vms?connId=c1') return reply(200, VMS)
  return reply(404, {})
})

const renderTab = () => renderWithProviders(
  <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0, refreshInterval: 0 }}><FlowsTab /></SWRConfig>,
)

beforeEach(() => {
  policy = POLICY
  pairs = PAIRS
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  window.localStorage.clear()
  window.history.replaceState(null, '', '/operations/network-flows?groupBy=zone')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FlowsTab grouped by zone', () => {
  it('opens in Zone mode from the link, with the strip and the Micro-segmentation column', async () => {
    renderTab()

    expect(await screen.findByTestId('traffic-by-zone')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zone' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('columnheader', { name: 'Micro-segmentation' })).toBeInTheDocument()
    expect(screen.getAllByTestId('microseg-status').map(c => c.dataset.status)).toEqual([
      'allowed', 'not_covered', 'not_covered', 'blocked', 'unknown', 'unknown',
    ])
    // The ends of a pair carry their zone in front of the address.
    const firstRow = screen.getAllByTestId('microseg-status')[0].closest('tr')!
    expect(within(firstRow).getByText('web')).toBeInTheDocument()
    expect(within(firstRow).getByText('db')).toBeInTheDocument()
  })

  it('says the statuses read a draft with changes not applied yet', async () => {
    policy = { ...POLICY, pending_changes: true }
    renderTab()
    expect(await screen.findByText('Read against the draft, which has changes not applied yet')).toBeInTheDocument()
  })

  it('goes back to the plain table when VM is chosen, and remembers it', async () => {
    renderTab()
    await screen.findByTestId('traffic-by-zone')
    fireEvent.click(screen.getByRole('button', { name: 'VM' }))
    expect(screen.queryByTestId('traffic-by-zone')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Micro-segmentation' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem('networkFlows.groupBy')).toBe('vm')
  })

  it('keeps Zone disabled and shows the VM grouping while no policy is applied', async () => {
    policy = { ...POLICY, last_revision: null }
    renderTab()
    await screen.findByRole('button', { name: 'VM' })
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/microseg/c1/policy'))).toBe(true))
    expect(screen.getByRole('button', { name: 'Zone' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'VM' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('traffic-by-zone')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Micro-segmentation' })).not.toBeInTheDocument()
  })

  it('waits for sFlow data like the other groupings', async () => {
    pairs = []
    renderTab()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Zone' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.queryByTestId('traffic-by-zone')).not.toBeInTheDocument()
    expect(screen.getAllByText('Waiting for sFlow data...', { exact: false }).length).toBeGreaterThan(0)
  })
})
