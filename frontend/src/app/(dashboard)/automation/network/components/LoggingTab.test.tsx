/**
 * LoggingTab (ui#1114): one list of every element of the infrastructure, and
 * no log read until one is picked. The log API is mocked; the guests and the
 * node states come from the connection's resources and nodes routes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

vi.mock('@/lib/api/firewall', () => ({ getFirewallLog: vi.fn() }))

import * as firewallAPI from '@/lib/api/firewall'

import LoggingTab from './LoggingTab'

const api = firewallAPI as unknown as Record<string, ReturnType<typeof vi.fn>>

const RESOURCES = [
  { vmid: 101, name: 'debian-test', node: 'pve1', type: 'lxc', status: 'running' },
  { vmid: 9000, name: 'tpl', node: 'pve1', type: 'qemu', status: 'stopped', template: true },
]

const NODES = [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }]

const fetchMock = vi.fn(async (url: string) => ({
  ok: true,
  json: async () => ({ data: url.endsWith('/resources') ? RESOURCES : NODES }),
}))

beforeEach(() => {
  api.getFirewallLog.mockReset()
  api.getFirewallLog.mockResolvedValue({ rows: [], warnings: [], truncated: false })
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderTab(firewallMode: 'cluster' | 'standalone' = 'cluster') {
  return renderWithProviders(
    <LoggingTab
      selectedConnection="conn-1"
      nodesList={['pve2', 'pve1']}
      securityGroups={[{ group: 'r1114', comment: 'ui#1114 repro' }]}
      firewallMode={firewallMode}
    />
  )
}

async function openList() {
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  fireEvent.mouseDown(screen.getByRole('combobox'))

  return screen.findByRole('listbox')
}

describe('LoggingTab', () => {
  it('lists the cluster, the nodes, the guests and the groups, and reads nothing yet', async () => {
    renderTab()

    const list = await openList()
    const options = within(list).getAllByRole('option').map(o => o.textContent)

    expect(options).toEqual([
      expect.stringContaining('Datacenter and host rules'),
      'pve1',
      'pve2',
      expect.stringContaining('debian-test #101'),
      expect.stringContaining('r1114'),
    ])
    expect(within(list).getByText('VMs and containers')).toBeInTheDocument()
    expect(screen.getByText('Pick an element to read its firewall log.')).toBeInTheDocument()
    expect(api.getFirewallLog).not.toHaveBeenCalled()
  })

  it.each([
    ['Datacenter and host rules', { kind: 'cluster' }],
    ['pve2', { kind: 'node', node: 'pve2' }],
    ['debian-test #101', { kind: 'vm', node: 'pve1', vmType: 'lxc', vmid: 101 }],
    ['r1114', { kind: 'group', group: 'r1114' }],
  ])('reads the log of %s once picked', async (label, scope) => {
    renderTab()

    const list = await openList()

    fireEvent.click(within(list).getAllByRole('option').find(o => o.textContent?.startsWith(label))!)

    await waitFor(() => expect(api.getFirewallLog).toHaveBeenCalledWith('conn-1', scope, 3600))
    expect(screen.queryByText('Pick an element to read its firewall log.')).toBeNull()
  })

  it('finds a guest by its node', async () => {
    renderTab()
    await openList()

    const input = screen.getByRole('combobox')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'pve1' } })

    await waitFor(() => expect(within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent))
      .toEqual(['pve1', expect.stringContaining('debian-test #101')]))
  })

  it('leaves the cluster out on a standalone node', async () => {
    renderTab('standalone')

    const list = await openList()

    expect(within(list).queryByText('Datacenter and host rules')).toBeNull()
  })
})
