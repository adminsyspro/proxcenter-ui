/**
 * LoggingTab (ui#1114): one list of every element of the infrastructure, and
 * no log read until one is picked. The log API is mocked; the guests and the
 * node states come from the connection's resources and nodes routes. The
 * Micro-segmentation source reads the orchestrator's event ring (the relay's
 * /events route), is offered once a revision of the policy was applied, and
 * refreshes only while it is the one picked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

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

const POLICY = {
  policy: { id: 'p1', connection_id: 'conn-1' },
  zones: [{ id: 'z1', name: 'web', color: '#22c55e' }],
  flows: [], pending_members: [], version: 3, pending_changes: false,
  last_revision: { id: 'rev-1', version: 3, author: 'admin', created_at: '2026-11-03T08:00:00Z' },
}

let policy: Record<string, unknown> | null = POLICY

const EVENTS = {
  events: [{
    seq: 7, ts: '2026-11-03T10:00:00Z', node: 'pve1', vmid: 101, type: 'lxc', guest: 'debian-test', zone: 'web', src_zone: '',
    src_ip: '10.0.0.5', dst_ip: '10.0.1.7', proto: 'tcp', dport: 22, verdict: 'would_block',
  }],
  truncated: false,
  oldest: '2026-11-03T10:00:00Z',
}

const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body })

const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith('/policy')) return policy ? answer(policy) : answer({ code: 'NOT_FOUND', error: 'no policy' }, 404)
  if (url.includes('/events')) return answer(EVENTS)

  return answer({ data: url.endsWith('/resources') ? RESOURCES : NODES })
})

const eventReads = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/events')).length

beforeEach(() => {
  policy = POLICY
  api.getFirewallLog.mockReset()
  api.getFirewallLog.mockResolvedValue({ rows: [], warnings: [], truncated: false })
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderTab(firewallMode: 'cluster' | 'standalone' = 'cluster') {
  // The shared test provider does not read on mount; the page does.
  return renderWithProviders(
    <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0 }}>
      <LoggingTab
        selectedConnection="conn-1"
        nodesList={['pve2', 'pve1']}
        securityGroups={[{ group: 'r1114', comment: 'ui#1114 repro' }]}
        firewallMode={firewallMode}
      />
    </SWRConfig>
  )
}

async function openList() {
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  // The policy answer decides whether the Micro-segmentation option is offered.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  fireEvent.mouseDown(screen.getByRole('combobox'))

  return screen.findByRole('listbox')
}

describe('LoggingTab', () => {
  it('lists the cluster, the nodes, the guests and the groups, and reads nothing yet', async () => {
    renderTab()

    const list = await openList()
    const options = within(list).getAllByRole('option').map(o => o.textContent)

    expect(options).toEqual([
      expect.stringContaining('Micro-segmentation (zone guests)'),
      expect.stringContaining('Datacenter and host rules'),
      'pve1',
      'pve2',
      expect.stringContaining('debian-test #101'),
      expect.stringContaining('r1114'),
    ])
    expect(within(list).getByText('VMs and containers')).toBeInTheDocument()
    expect(within(list).getByText('Zone engine')).toBeInTheDocument()
    expect(screen.getByText('Pick an element to read its firewall log.')).toBeInTheDocument()
    expect(api.getFirewallLog).not.toHaveBeenCalled()
    expect(eventReads()).toBe(0)
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
  describe('Micro-segmentation source', () => {
    const option = (list: HTMLElement) => within(list).getAllByRole('option').find(o => o.textContent?.startsWith('Micro-segmentation (zone guests)'))!

    it('is offered once a revision was applied, and reads the event ring, not Proxmox', async () => {
      renderTab()

      const list = await openList()

      expect(option(list)).not.toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(option(list))

      expect(await screen.findByText('debian-test')).toBeInTheDocument()
      expect(screen.getByText('10.0.0.5')).toBeInTheDocument()
      expect(screen.queryByText('Pick an element to read its firewall log.')).toBeNull()
      expect(eventReads()).toBe(1)
      expect(api.getFirewallLog).not.toHaveBeenCalled()
    })

    it.each([
      ['has no policy', null],
      ['has a draft that was never applied', { ...POLICY, last_revision: null }],
    ])('is disabled, with the reason in a tooltip, on a connection that %s', async (_, body) => {
      policy = body

      renderTab()

      const list = await openList()

      expect(option(list)).toHaveAttribute('aria-disabled', 'true')

      fireEvent.mouseOver(within(option(list)).getByText('Micro-segmentation (zone guests)'))
      expect(await screen.findByText('Needs a micro-segmentation policy with an applied revision on this connection.')).toBeInTheDocument()

      fireEvent.click(option(list))
      expect(screen.getByText('Pick an element to read its firewall log.')).toBeInTheDocument()
      expect(eventReads()).toBe(0)
    })

    it('is read every minute only while it is the picked source', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
      renderTab()

      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      fireEvent.mouseDown(screen.getByRole('combobox'))

      const list = screen.getByRole('listbox')

      // Not picked: nothing is read, however long the tab stays open.
      await act(async () => { await vi.advanceTimersByTimeAsync(180_000) })
      expect(eventReads()).toBe(0)

      fireEvent.click(option(list))
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      expect(eventReads()).toBe(1)

      await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })
      expect(eventReads()).toBe(2)

      // Another source picked: the refresh stops.
      fireEvent.mouseDown(screen.getAllByRole('combobox')[0])
      fireEvent.click(within(screen.getByRole('listbox')).getAllByRole('option').find(o => o.textContent?.startsWith('pve2'))!)
      await act(async () => { await vi.advanceTimersByTimeAsync(180_000) })
      expect(eventReads()).toBe(2)
    })
  })

  it('keeps the empty state of a Proxmox log inside the table width', async () => {
    renderTab()

    const list = await openList()

    fireEvent.click(within(list).getAllByRole('option').find(o => o.textContent === 'pve2')!)

    const title = await screen.findByText('No entry over this period.')
    const hint = screen.getByText(/Only rules with a log level other than nolog/)
    const cell = title.closest('td') as HTMLElement

    expect(getComputedStyle(cell).whiteSpace).toBe('normal')
    expect(getComputedStyle(cell).textAlign).toBe('center')

    for (const text of [title, hint]) {
      expect(getComputedStyle(text).whiteSpace).toBe('normal')
      expect(getComputedStyle(text).maxWidth).toBe('520px')
    }
  })
})
