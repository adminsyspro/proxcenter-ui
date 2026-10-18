/**
 * FirewallLogDialog (ui#1114): the parsed rows of a guest or a security group,
 * with search, filters, the decision in color and the node warnings. The API
 * module is mocked; the rows are shaped as lib/firewall/logs.ts returns them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

vi.mock('@/lib/api/firewall', () => ({ getFirewallLog: vi.fn() }))

import * as firewallAPI from '@/lib/api/firewall'

import FirewallLogDialog from './FirewallLogDialog'

const api = firewallAPI as unknown as Record<string, ReturnType<typeof vi.fn>>

const TS = Date.UTC(2026, 9, 15, 20, 59, 42)

const row = (over: Record<string, unknown>) => ({
  id: String(Math.random()), node: 'pve1', ts: TS, level: 6, chain: 'veth101i0-IN', direction: 'in',
  actionInferred: false, policy: false, origin: 'guest', vmid: 101,
  src: '10.42.0.101', dst: '10.42.0.249', proto: 'TCP', raw: 'raw line', ...over,
})

const GROUP_DROP = row({ id: 'a', origin: 'group', group: 'r1114', chain: 'GROUP-r1114-IN', action: 'DROP', actionInferred: true, dport: 9999, raw: '0 6 GROUP-r1114-IN ... DPT=9999' })
const GUEST_ACCEPT = row({ id: 'b', action: 'ACCEPT', dport: 22, raw: '101 6 veth101i0-IN ... DPT=22' })
const GROUP_UNKNOWN = row({ id: 'c', origin: 'group', group: 'r1114', chain: 'GROUP-r1114-IN', vmid: 102, node: 'pve2', dport: 80, raw: '0 6 GROUP-r1114-IN ... DPT=80' })

const VM_SCOPE = { kind: 'vm' as const, node: 'pve1', vmType: 'lxc' as const, vmid: 101 }

afterEach(cleanup)

beforeEach(() => {
  api.getFirewallLog.mockReset()
})

/** The rows of the log table, header excluded. */
const bodyRows = () => screen.getAllByRole('row').filter(r => r.closest('tbody'))

/** Opens a TextField select by its label and picks an option. */
function pick(label: string, option: string) {
  const control = screen.getAllByText(label).find(el => el.tagName === 'LABEL')!.parentElement!

  fireEvent.mouseDown(within(control).getByRole('combobox'))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }))
}

describe('FirewallLogDialog', () => {
  it('shows a guest\'s own rule and its security group hits, the deduced action marked', async () => {
    api.getFirewallLog.mockResolvedValue({ rows: [GROUP_DROP, GUEST_ACCEPT], warnings: [], truncated: false })

    renderWithProviders(<FirewallLogDialog open onClose={() => {}} connectionId="conn-1" scope={VM_SCOPE} subject="debian-test" />)

    await waitFor(() => expect(bodyRows()).toHaveLength(2))
    expect(api.getFirewallLog).toHaveBeenCalledWith('conn-1', VM_SCOPE, 3600)

    const [drop, accept] = bodyRows()

    expect(drop).toHaveTextContent('DROP≈')
    expect(drop).toHaveTextContent('Group r1114')
    expect(drop).toHaveTextContent('TCP 9999')
    expect(accept).toHaveTextContent('ACCEPT')
    expect(accept).toHaveTextContent('Guest rule')
  })

  it('narrows by search and by action, and shows the raw line on expand', async () => {
    api.getFirewallLog.mockResolvedValue({ rows: [GROUP_DROP, GUEST_ACCEPT], warnings: [], truncated: false })

    renderWithProviders(<FirewallLogDialog open onClose={() => {}} connectionId="conn-1" scope={VM_SCOPE} />)
    await waitFor(() => expect(bodyRows()).toHaveLength(2))

    fireEvent.change(screen.getByPlaceholderText('Search an IP, a port, a group…'), { target: { value: 'DPT=22' } })
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]).toHaveTextContent('ACCEPT')

    fireEvent.change(screen.getByPlaceholderText('Search an IP, a port, a group…'), { target: { value: '' } })
    pick('Action', 'DROP')
    expect(bodyRows()).toHaveLength(1)

    fireEvent.click(bodyRows()[0])
    expect(screen.getByText('0 6 GROUP-r1114-IN ... DPT=9999')).toBeInTheDocument()
  })

  it('lays the expanded line out one field per line, by block', async () => {
    const raw = '101 6 veth101i0-IN 15/Oct/2026:22:59:45 +0200 ACCEPT: IN=fwbr101i0 OUT=fwbr101i0 PHYSIN=fwln101i0 PHYSOUT=veth101i0 SRC=10.42.0.101 DST=10.42.0.249 LEN=60 TTL=64 ID=61039 DF PROTO=TCP SPT=56950 DPT=22 SEQ=1996169277 ACK=0 WINDOW=64240 SYN '

    api.getFirewallLog.mockResolvedValue({ rows: [{ ...GUEST_ACCEPT, raw }], warnings: [], truncated: false })

    renderWithProviders(<FirewallLogDialog open onClose={() => {}} connectionId="conn-1" scope={VM_SCOPE} guests={{ 101: { name: 'debian-test', type: 'lxc' } }} />)
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    fireEvent.click(bodyRows()[0])

    const value = (label: string) => screen.getByText(label).nextElementSibling

    expect(screen.getByText('Decision')).toBeInTheDocument()
    expect(screen.getByText('Interfaces')).toBeInTheDocument()
    expect(screen.getByText('Flow')).toBeInTheDocument()
    expect(screen.getByText('IP / TCP header')).toBeInTheDocument()
    expect(value('Chain')).toHaveTextContent('veth101i0-IN')
    expect(value('Guest')).toHaveTextContent('debian-test #101')
    expect(value('Log level')).toHaveTextContent('info')
    expect(value('Physical input')).toHaveTextContent('fwln101i0')
    expect(value('Destination port')).toHaveTextContent('22')
    expect(value('Window')).toHaveTextContent('64240')
    expect(value('Flags')).toHaveTextContent('DF SYN')
    expect(screen.getByText(raw.trim())).toBeInTheDocument()

    const writeText = vi.fn(async () => {})

    Object.assign(navigator, { clipboard: { writeText } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith(raw)
  })

  it('names the guest and the node of a group hit, and leaves an unknown action grey', async () => {
    api.getFirewallLog.mockResolvedValue({ rows: [GROUP_UNKNOWN], warnings: [], truncated: false })

    renderWithProviders(
      <FirewallLogDialog
        open onClose={() => {}} connectionId="conn-1"
        scope={{ kind: 'group', group: 'r1114' }}
        guests={{ 102: { name: 'web-02', type: 'qemu', status: 'running' } }}
      />
    )

    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(bodyRows()[0]).toHaveTextContent('Unknown')
    expect(bodyRows()[0]).toHaveTextContent('web-02#102')
    expect(bodyRows()[0]).toHaveTextContent('pve2')
  })

  it('says which nodes could not be read for lack of Sys.Syslog', async () => {
    api.getFirewallLog.mockResolvedValue({
      rows: [], truncated: false,
      warnings: [{ node: 'pve1', kind: 'permission', message: '403' }, { node: 'pve3', kind: 'offline', message: 'offline' }],
    })

    renderWithProviders(<FirewallLogDialog open onClose={() => {}} connectionId="conn-1" scope={{ kind: 'group', group: 'r1114' }} />)

    await waitFor(() => expect(screen.getByText(/lacks Sys\.Syslog/)).toHaveTextContent('pve1'))
    expect(screen.getByText(/Offline, log not read/)).toHaveTextContent('pve3')
    expect(screen.getByText('No entry over this period.')).toBeInTheDocument()
  })

  it('polls every 5 seconds on short windows only', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    api.getFirewallLog.mockResolvedValue({ rows: [], warnings: [], truncated: false })

    try {
      renderWithProviders(<FirewallLogDialog open onClose={() => {}} connectionId="conn-1" scope={VM_SCOPE} />)
      await waitFor(() => expect(api.getFirewallLog).toHaveBeenCalledTimes(1))

      vi.advanceTimersByTime(5000)
      await waitFor(() => expect(api.getFirewallLog).toHaveBeenCalledTimes(2))

      pick('Period', 'Last 24 hours')
      await waitFor(() => expect(api.getFirewallLog).toHaveBeenLastCalledWith('conn-1', VM_SCOPE, 86400))
      const calls = api.getFirewallLog.mock.calls.length

      vi.advanceTimersByTime(15000)
      expect(api.getFirewallLog).toHaveBeenCalledTimes(calls)
    } finally {
      vi.useRealTimers()
    }
  })

  it('narrows to one group rule, and marks a line the log cannot pin on it alone', async () => {
    api.getFirewallLog.mockResolvedValue({
      rows: [
        { ...GROUP_DROP, id: 'sure', ruleCandidates: [1] },
        { ...GROUP_DROP, id: 'unsure', dport: 9998, ruleCandidates: [0, 1] },
        { ...GROUP_UNKNOWN, id: 'other', ruleCandidates: [0] },
      ],
      warnings: [], truncated: false,
    })

    renderWithProviders(
      <FirewallLogDialog open onClose={() => {}} connectionId="conn-1" scope={{ kind: 'group', group: 'r1114' }}
        subject="r1114 · rule #1" ruleFilter={{ kind: 'groupRule', group: 'r1114', pos: 1 }} />
    )

    await waitFor(() => expect(bodyRows()).toHaveLength(2))
    expect(bodyRows()[0].querySelector('.ri-question-line')).toBeNull()
    expect(bodyRows()[1].querySelector('.ri-question-line')).not.toBeNull()

    fireEvent.mouseOver(bodyRows()[1].querySelector('.ri-question-line')!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('cannot tell this rule from #0')
  })

  it('narrows a guest log to one of its own rules, or to every hit of a referenced group', async () => {
    const rows = [
      { ...GROUP_DROP, ruleCandidates: [1] },
      { ...GUEST_ACCEPT, ruleCandidates: [3] },
      { ...GUEST_ACCEPT, id: 'policy', policy: true, action: 'DROP' },
    ]

    api.getFirewallLog.mockResolvedValue({ rows, warnings: [], truncated: false })

    const { unmount } = renderWithProviders(
      <FirewallLogDialog open onClose={() => {}} connectionId="conn-1" scope={VM_SCOPE} ruleFilter={{ kind: 'guestRule', pos: 3 }} />
    )

    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(bodyRows()[0]).toHaveTextContent('Guest rule')
    unmount()

    renderWithProviders(
      <FirewallLogDialog open onClose={() => {}} connectionId="conn-1" scope={VM_SCOPE} ruleFilter={{ kind: 'groupRef', group: 'R1114' }} />
    )

    await waitFor(() => expect(bodyRows()).toHaveLength(1))
    expect(bodyRows()[0]).toHaveTextContent('Group r1114')
  })
})

