/**
 * Tests for listing, attaching and detaching security-group guest members.
 *
 * PVE stores membership as a group rule on each guest. These tests therefore
 * drive the dialog with real guest rule lists and assert the exact VM firewall
 * adapter calls. MUI Autocomplete needs scrollIntoView in a browser, but jsdom
 * does not provide it.
 */

import type { ComponentProps } from 'react'

import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from '@/__tests__/setup/renderWithProviders'
import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'
import type { FirewallRule } from '@/lib/api/firewall'

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }))

vi.mock('@/lib/api/firewall', () => ({
  addVMRule: vi.fn(),
  deleteVMRule: vi.fn(),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
}))

import * as firewallAPI from '@/lib/api/firewall'

import SecurityGroupMembersDialog from './SecurityGroupMembersDialog'

Element.prototype.scrollIntoView ??= vi.fn()

const addVMRule = vi.mocked(firewallAPI.addVMRule)
const deleteVMRule = vi.mocked(firewallAPI.deleteVMRule)

const GROUP = 'sg-web'
const CONNECTION = 'conn-1'

const groupRule = (group: string, pos = 0, enable = 1): FirewallRule => ({
  pos,
  type: 'group',
  action: group,
  enable,
})

function guest(vmid: number, overrides: Partial<VMFirewallInfo> = {}): VMFirewallInfo {
  return {
    vmid,
    name: `guest-${vmid}`,
    node: 'pve1',
    type: 'qemu',
    status: 'running',
    firewallEnabled: true,
    rules: [],
    options: null,
    vlans: [],
    ...overrides,
  }
}

function props(overrides: Partial<ComponentProps<typeof SecurityGroupMembersDialog>> = {}) {
  return {
    open: true,
    groupName: GROUP,
    connectionId: CONNECTION,
    guests: [],
    guestsNotScanned: 0,
    onClose: vi.fn(),
    onChanged: vi.fn(),
    ...overrides,
  }
}

function renderDialog(overrides: Parameters<typeof props>[0] = {}) {
  const dialogProps = props(overrides)
  const rendered = renderWithProviders(<SecurityGroupMembersDialog {...dialogProps} />)

  return { dialogProps, rendered }
}

async function chooseGuest(label: string) {
  const input = screen.getByLabelText('Guests to attach')

  fireEvent.change(input, { target: { value: label } })
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

beforeEach(() => {
  addVMRule.mockReset().mockResolvedValue(undefined)
  deleteVMRule.mockReset().mockResolvedValue(undefined)
  showToast.mockReset()
})

afterEach(cleanup)

describe('SecurityGroupMembersDialog', () => {
  it('derives the current members from exact group rules on the guests', () => {
    const member = guest(100, { name: 'web-01', rules: [groupRule(GROUP, 4, 0)] })
    const otherGroup = guest(101, { name: 'db-01', rules: [groupRule('sg-db', 2)] })
    const ordinaryRule = guest(102, {
      name: 'worker-01',
      rules: [{ pos: 1, type: 'in', action: GROUP, enable: 1 }],
    })

    renderDialog({ guests: [member, otherGroup, ordinaryRule] })

    expect(screen.getByText('Members of sg-web')).toBeInTheDocument()
    expect(screen.getByText('web-01 (100)')).toBeInTheDocument()
    expect(screen.queryByText('db-01 (101)')).not.toBeInTheDocument()
    expect(screen.queryByText('worker-01 (102)')).not.toBeInTheDocument()
    expect(screen.getByText('Attached guests').parentElement).toHaveTextContent('1')
  })

  it('shows the empty state when no guest references the group', () => {
    renderDialog({ guests: [guest(110, { rules: [groupRule('sg-other')] })] })

    expect(screen.getByText('No guest references this group yet')).toBeInTheDocument()
    expect(screen.getByText('Attached guests').parentElement).toHaveTextContent('0')
  })

  it('attaches two selected guests sequentially with one group rule each', async () => {
    const first = guest(120, { name: 'app-01' })
    const second = guest(121, { name: 'app-02', node: 'pve2', type: 'lxc' })
    let finishFirst: (() => void) | undefined

    addVMRule
      .mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve }))
      .mockResolvedValueOnce(undefined)

    const { dialogProps } = renderDialog({ guests: [first, second] })

    await chooseGuest('app-01 (120)')
    await chooseGuest('app-02 (121)')
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))

    await waitFor(() => expect(addVMRule).toHaveBeenCalledTimes(1))
    expect(addVMRule).toHaveBeenNthCalledWith(1, CONNECTION, 'pve1', 'qemu', 120, {
      type: 'group',
      action: GROUP,
      enable: 1,
    })

    await act(async () => finishFirst?.())

    await waitFor(() => expect(addVMRule).toHaveBeenCalledTimes(2))
    expect(addVMRule).toHaveBeenNthCalledWith(2, CONNECTION, 'pve2', 'lxc', 121, {
      type: 'group',
      action: GROUP,
      enable: 1,
    })
    await waitFor(() => expect(dialogProps.onChanged).toHaveBeenCalledWith([first, second]))
  })

  it('keeps successful attachments and reports the guests that failed', async () => {
    const failed = guest(130, { name: 'broken-01' })
    const attached = guest(131, { name: 'healthy-01' })

    addVMRule
      .mockRejectedValueOnce(new Error('PVE rejected the rule'))
      .mockResolvedValueOnce(undefined)

    const { dialogProps } = renderDialog({ guests: [failed, attached] })

    await chooseGuest('broken-01 (130)')
    await chooseGuest('healthy-01 (131)')
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))

    await waitFor(() => expect(dialogProps.onChanged).toHaveBeenCalledWith([attached]))
    expect(addVMRule).toHaveBeenCalledTimes(2)
    expect(showToast).toHaveBeenCalledWith('sg-web attached to 1 guest(s)', 'success')
    expect(showToast).toHaveBeenCalledWith('Could not attach: broken-01 (130)', 'error')
  })

  it('detaches a member by deleting the matching group rule position', async () => {
    const member = guest(140, {
      name: 'web-02',
      rules: [groupRule('sg-other', 2), groupRule(GROUP, 7)],
    })
    const { dialogProps } = renderDialog({ guests: [member] })

    fireEvent.click(screen.getByRole('button', { name: 'Detach' }))

    await waitFor(() => {
      expect(deleteVMRule).toHaveBeenCalledWith(CONNECTION, 'pve1', 'qemu', 140, 7)
    })
    expect(dialogProps.onChanged).toHaveBeenCalledWith([member])
    expect(showToast).toHaveBeenCalledWith('sg-web detached from web-02 (140)', 'success')
  })

  it('shows the partial-scan notice only when guests were skipped', () => {
    const initialProps = props({ guestsNotScanned: 12 })
    const { rerender } = renderWithProviders(<SecurityGroupMembersDialog {...initialProps} />)

    expect(screen.getByText('12 guests were not scanned, this count may be incomplete')).toBeInTheDocument()

    rerender(<SecurityGroupMembersDialog {...initialProps} guestsNotScanned={0} />)

    expect(screen.queryByText('12 guests were not scanned, this count may be incomplete')).not.toBeInTheDocument()
  })

  it('does not offer guests that already carry the group rule', async () => {
    const attached = guest(150, { name: 'web-attached', rules: [groupRule(GROUP, 3)] })
    const candidate = guest(151, { name: 'web-candidate' })

    renderDialog({ guests: [attached, candidate] })

    fireEvent.change(screen.getByLabelText('Guests to attach'), { target: { value: 'web' } })

    expect(await screen.findByRole('option', { name: 'web-candidate (151)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'web-attached (150)' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1)
  })
})
