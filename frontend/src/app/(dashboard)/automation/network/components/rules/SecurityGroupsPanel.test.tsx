/**
 * Component tests for SecurityGroupsPanel.tsx — the security groups rules
 * table.
 *
 * Two things are specific to this panel and asserted here. First, it owns an
 * extra "Applied To" column: the count of guests whose rules reference the
 * group, derived from the VM firewall data rather than given by the caller,
 * so a wrong derivation shows an operator the wrong blast radius. Second, a
 * security group cannot itself hold a group rule (PVE forbids nesting), so
 * the shared row cells are rendered without `isGroupRule` and a rule that
 * names a group keeps the plain rendering.
 *
 * The rule form is the shared RuleFormDialog, covered on its own; what is
 * checked here is that the panel pre-fills it from the right rule and sends
 * the result to the right group.
 *
 * `window.confirm` gates the group deletion and jsdom does not implement it,
 * so it is stubbed per test rather than globally.
 *
 * No automatic RTL cleanup is configured in this repo, hence afterEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from '@/__tests__/setup/renderWithProviders'
import type * as firewallAPIType from '@/lib/api/firewall'
import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

vi.mock('@/lib/api/firewall', () => ({
  addSecurityGroupRule: vi.fn(),
  updateSecurityGroupRule: vi.fn(),
  deleteSecurityGroupRule: vi.fn(),
  createSecurityGroup: vi.fn(),
  deleteSecurityGroup: vi.fn(),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import * as firewallAPI from '@/lib/api/firewall'

import SecurityGroupsPanel from './SecurityGroupsPanel'

const api = firewallAPI as unknown as Record<string, ReturnType<typeof vi.fn>>

const CONN = 'conn-1'

const WEB_RULE: firewallAPIType.FirewallRule = {
  pos: 0, type: 'in', action: 'ACCEPT', enable: 1,
  proto: 'tcp', dport: '443', source: '10.0.0.0/8', log: 'warning', comment: 'https in',
}

const DISABLED_RULE: firewallAPIType.FirewallRule = { pos: 1, type: 'in', action: 'DROP', enable: 0 }

const GROUPS: firewallAPIType.SecurityGroup[] = [
  { group: 'sg-web', comment: 'front tier', rules: [WEB_RULE, DISABLED_RULE] },
  { group: 'sg-db', rules: [] },
]

/** A guest whose rules reference sg-web, so the group counts one applied VM. */
const WEB_VM: VMFirewallInfo = {
  vmid: 100, name: 'web-01', node: 'pve1', type: 'qemu', status: 'running',
  firewallEnabled: true, options: null, vlans: [20],
  rules: [{ pos: 0, type: 'group', action: 'sg-web', enable: 1 }],
}

function props(overrides: Partial<React.ComponentProps<typeof SecurityGroupsPanel>> = {}) {
  return {
    securityGroups: GROUPS,
    vmFirewallData: [WEB_VM],
    firewallMode: 'cluster' as firewallAPIType.FirewallMode,
    selectedConnection: CONN,
    totalRules: 2,
    aliases: [{ name: 'net-mgmt', cidr: '10.99.99.0/24' }] as firewallAPIType.Alias[],
    ipsets: [] as firewallAPIType.IPSet[],
    reload: vi.fn(),
    ...overrides,
  }
}

function renderPanel(overrides: Parameters<typeof props>[0] = {}) {
  const p = props(overrides)

  renderWithProviders(<SecurityGroupsPanel {...p} />)

  return p
}

const expandGroup = (name: string) => fireEvent.click(screen.getByText(name))

const ruleRow = (text: string) => screen.getAllByRole('row').find(r => within(r).queryByText(text))!

/** A Select inside the open rule dialog, found from its rendered label. */
function selectByLabel(label: string) {
  const el = screen.queryAllByText(label).find(n => n.tagName === 'LABEL')

  if (!el?.parentElement) throw new Error(`No Select labelled "${label}"`)

  return within(el.parentElement).getByRole('combobox')
}

describe('SecurityGroupsPanel', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    api.addSecurityGroupRule.mockResolvedValue(undefined)
    api.updateSecurityGroupRule.mockResolvedValue(undefined)
    api.deleteSecurityGroupRule.mockResolvedValue(undefined)
    api.createSecurityGroup.mockResolvedValue(undefined)
    api.deleteSecurityGroup.mockResolvedValue(undefined)
  })

  it('lists each group collapsed, with its comment, rule count and applied guests', () => {
    renderPanel()

    expect(screen.getByText('sg-web')).toBeInTheDocument()
    expect(screen.getByText('— front tier')).toBeInTheDocument()
    expect(screen.getByText('2 rules')).toBeInTheDocument()
    expect(screen.getByText('0 rules')).toBeInTheDocument()

    // sg-web is referenced by web-01, sg-db by nobody.
    expect(screen.getByText('1 VMs')).toBeInTheDocument()
    expect(screen.getByText('0 VMs')).toBeInTheDocument()

    expect(screen.queryByText('https in')).not.toBeInTheDocument()
  })

  it('carries an Applied To column the other rules tables do not have', () => {
    renderPanel()

    expect(screen.getByText('Applied To')).toBeInTheDocument()
  })

  it('reveals a group\'s rules, with their log level, when expanded', () => {
    renderPanel()

    expandGroup('sg-web')

    expect(screen.getByText('https in')).toBeInTheDocument()
    expect(screen.getByText('warning')).toBeInTheDocument()
    expect(screen.getByText('TCP/443')).toBeInTheDocument()

    expandGroup('sg-web')
    expect(screen.queryByText('https in')).not.toBeInTheDocument()
  })

  it('offers to create a rule in a group that has none', () => {
    renderPanel()

    expandGroup('sg-db')

    const emptyRow = screen.getAllByRole('row').find(r => within(r).queryByText('No rules'))!

    fireEvent.click(within(emptyRow).getByRole('button', { name: 'Add rule' }))

    expect(screen.getByText('SG: sg-db')).toBeInTheDocument()
  })

  it('expands and collapses every group at once, and filters by search', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText('https in')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('https in')).not.toBeInTheDocument()

    // Search matches the group name, its comment and its rules' fields.
    fireEvent.change(screen.getByPlaceholderText('Search policies...'), { target: { value: 'front' } })
    expect(screen.getByText('sg-web')).toBeInTheDocument()
    expect(screen.queryByText('sg-db')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search policies...'), { target: { value: 'nope' } })
    expect(screen.getByText('No Security Group')).toBeInTheDocument()
  })

  it('toggles a rule Active switch against its group and position', async () => {
    renderPanel()
    expandGroup('sg-web')

    fireEvent.click(within(ruleRow('https in')).getByRole('switch'))

    await waitFor(() => expect(api.updateSecurityGroupRule).toHaveBeenCalledTimes(1))
    expect(api.updateSecurityGroupRule.mock.calls[0].slice(0, 3)).toEqual([CONN, 'sg-web', 0])
    expect(api.updateSecurityGroupRule.mock.calls[0][3]).toMatchObject({ enable: 0, log: 'warning' })
  })

  it('re-enables a rule PVE returned as disabled', async () => {
    renderPanel()
    expandGroup('sg-web')

    const row = screen.getAllByRole('row').find(r => within(r).queryByText('DROP'))!
    const toggle = within(row).getByRole('switch')

    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)

    await waitFor(() => expect(api.updateSecurityGroupRule).toHaveBeenCalledTimes(1))
    expect(api.updateSecurityGroupRule.mock.calls[0][3]).toMatchObject({ enable: 1 })
  })

  it('pre-fills the edit dialog from the rule and saves it to the group', async () => {
    renderPanel()
    expandGroup('sg-web')

    fireEvent.click(within(ruleRow('https in')).getByRole('button', { name: 'Edit' }))

    await waitFor(() => expect(screen.getByText('SG: sg-web')).toBeInTheDocument())

    const dialog = within(screen.getByRole('dialog'))

    expect(dialog.getByLabelText('Source')).toHaveValue('10.0.0.0/8')
    expect(dialog.getByLabelText('Dest port')).toHaveValue('443')
    expect(dialog.getByLabelText('Comment')).toHaveValue('https in')
    expect(selectByLabel('Log level')).toHaveTextContent('warning')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.updateSecurityGroupRule).toHaveBeenCalledTimes(1))
    expect(api.updateSecurityGroupRule.mock.calls[0].slice(0, 3)).toEqual([CONN, 'sg-web', 0])
    expect(api.updateSecurityGroupRule.mock.calls[0][3]).toMatchObject({ log: 'warning' })
  })

  it('adds a rule to a group with the picked log level', async () => {
    const p = renderPanel()

    expandGroup('sg-web')

    const section = screen.getAllByRole('row').find(r => within(r).queryByText('sg-web'))!

    fireEvent.click(within(section).getByRole('button', { name: 'Add rule' }))
    await waitFor(() => expect(screen.getByText('SG: sg-web')).toBeInTheDocument())

    fireEvent.mouseDown(selectByLabel('Log level'))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'info' }))

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(api.addSecurityGroupRule).toHaveBeenCalledTimes(1))
    expect(api.addSecurityGroupRule).toHaveBeenCalledWith(CONN, 'sg-web', expect.objectContaining({ log: 'info' }))
    expect(p.reload).toHaveBeenCalled()
  })

  it('confirms before deleting a rule, then deletes it', async () => {
    renderPanel()
    expandGroup('sg-web')

    fireEvent.click(within(ruleRow('https in')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByText('Delete this rule?')).toBeInTheDocument())

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteSecurityGroupRule).toHaveBeenCalledWith(CONN, 'sg-web', 0))
  })

  it('asks the browser to confirm before deleting a whole group', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderPanel()

    const section = screen.getAllByRole('row').find(r => within(r).queryByText('sg-web'))!

    fireEvent.click(within(section).getByRole('button', { name: 'Delete' }))

    expect(confirmSpy).toHaveBeenCalledWith('Delete Security Group "sg-web"?')
    expect(api.deleteSecurityGroup).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(within(section).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteSecurityGroup).toHaveBeenCalledWith(CONN, 'sg-web'))
    confirmSpy.mockRestore()
  })

  it('creates a group from the New Policy dialog', async () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'New Policy' }))

    await waitFor(() => expect(screen.getByText('Create Security Group')).toBeInTheDocument())

    const dialog = within(screen.getByRole('dialog'))

    // The Create button stays disabled until the group has a name.
    expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()

    fireEvent.change(dialog.getByLabelText('Name'), { target: { value: 'sg-new' } })
    fireEvent.change(dialog.getByLabelText('Description'), { target: { value: 'from test' } })

    fireEvent.click(dialog.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.createSecurityGroup).toHaveBeenCalledWith(CONN, { group: 'sg-new', comment: 'from test' }))
  })

  it('explains that security groups need a cluster when the node is standalone', () => {
    renderPanel({ firewallMode: 'standalone' })

    expect(screen.getByText('Security Groups not available')).toBeInTheDocument()

    // The rules table is replaced entirely, not merely disabled.
    expect(screen.queryByText('sg-web')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New Policy' })).not.toBeInTheDocument()
  })

  it('offers to create the first group when the connection has none', () => {
    renderPanel({ securityGroups: [] })

    expect(screen.getByText('No Security Group')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    expect(screen.getByText('Create Security Group')).toBeInTheDocument()
  })
})
