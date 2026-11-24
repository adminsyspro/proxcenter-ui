/**
 * Component tests for SecurityGroupsPanel.tsx — the security groups rules
 * table.
 *
 * Two things are specific to this panel and asserted here. First, membership:
 * the count of guests whose rules reference the group is derived from the VM
 * firewall data rather than given by the caller, and it lives on the group
 * header row — a wrong derivation shows an operator the wrong blast radius.
 * Second, a
 * security group cannot itself hold a group rule (PVE forbids nesting), so
 * the shared row cells are rendered without `isGroupRule` and a rule that
 * names a group keeps the plain rendering.
 *
 * The rule form is the shared RuleFormDialog, covered on its own; what is
 * checked here is that the panel pre-fills it from the right rule and sends
 * the result to the right group.
 *
 * The group deletion is confirmed in a themed dialog, never a native confirm().
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
import type { GroupUsage } from '@/hooks/useGroupUsage'

vi.mock('@/lib/api/firewall', () => ({
  addSecurityGroupRule: vi.fn(),
  updateSecurityGroupRule: vi.fn(),
  deleteSecurityGroupRule: vi.fn(),
  createSecurityGroup: vi.fn(),
  deleteSecurityGroup: vi.fn(),

  // Used by the members dialog this panel opens, not by the panel itself.
  addVMRule: vi.fn(),
  deleteVMRule: vi.fn(),
  getVMRules: vi.fn(),
  // Read by the delete dialog when it opens: the nodes' own rules.
  getNodeRules: vi.fn(),
}))

// The deployed micro-segmentation revision the membership of the zone groups comes from (UA44): none by default.
const microseg = vi.hoisted(() => ({
  snapshot: null as null | Record<string, unknown>, zones: [] as Array<{ name: string; color: string }>, revisionLoading: false,
}))
vi.mock('@/lib/microseg/useMicroseg', () => ({
  useMicrosegPolicy: () => ({
    data: microseg.snapshot || microseg.zones.length || microseg.revisionLoading ? { last_revision: microseg.snapshot || microseg.revisionLoading ? { id: 'r1' } : null, zones: microseg.zones } : undefined,
    loading: false,
  }),
}))
vi.mock('@/lib/microseg/useLastRevision', () => ({
  useLastRevisionSnapshot: () => ({
    revision: microseg.snapshot && !microseg.revisionLoading ? { id: 'r1', snapshot: microseg.snapshot } : null,
    loading: microseg.revisionLoading,
  }),
}))

// The zone tags as the zone map reads them: none by default, so the tags of the guest rows apply.
const zoneGuests = vi.hoisted(() => ({ guests: [] as Array<{ type: string; vmid: number; tags: string[] }>, status: 'ready' as 'loading' | 'ready' | 'error', asked: [] as Array<string | null> }))
vi.mock('../microseg/useZoneGuests', () => ({
  useZoneGuests: (connectionId: string | null) => {
    zoneGuests.asked.push(connectionId)

    return { guests: zoneGuests.guests, status: connectionId ? zoneGuests.status : 'loading', reload: vi.fn(), unlisted: false }
  },
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import * as firewallAPI from '@/lib/api/firewall'

import SecurityGroupsPanel from './SecurityGroupsPanel'
import DeleteSecurityGroupDialog from './shared/DeleteSecurityGroupDialog'

const api = firewallAPI as unknown as Record<string, ReturnType<typeof vi.fn>>

const CONN = 'conn-1'

const WEB_RULE: firewallAPIType.FirewallRule = {
  pos: 0, type: 'in', action: 'ACCEPT', enable: 1,
  proto: 'tcp', dport: '443', source: '10.0.0.0/8', log: 'warning', comment: 'https in',
}

// Wire shape of a disabled rule: the orchestrator's omitempty drops enable: 0
// on the way, so the key is absent rather than 0 (#1015).
const DISABLED_RULE: firewallAPIType.FirewallRule = { pos: 1, type: 'in', action: 'DROP' }

const GROUPS: firewallAPIType.SecurityGroup[] = [
  { group: 'sg-web', comment: 'front tier', rules: [WEB_RULE, DISABLED_RULE] },
  { group: 'sg-db', rules: [] },
]

/** A guest whose rules reference sg-web, so the group counts one applied VM. */
const WEB_VM: VMFirewallInfo = {
  vmid: 100, name: 'web-01', node: 'pve1', type: 'qemu', status: 'running',
  firewallEnabled: true, optionsEnabled: true, nicFirewallEnabled: true, options: null, vlans: [20],
  rules: [{ pos: 0, type: 'group', action: 'sg-web', enable: 1 }], rulesLoaded: true, stateUnknown: false, tags: [],
}

const NO_NODES: string[] = []

/** A group rule pointing at `group`, as PVE stores membership. */
const groupRule = (group: string, pos = 0): firewallAPIType.FirewallRule => ({
  pos, type: 'group', action: group, enable: 1,
})

/** What the server read of the guests' rules: every guest by default, none of them carrying a group. */
const usage = (groups: GroupUsage['groups'] = {}, unread = 0): GroupUsage => ({
  total: 10, measured: 10 - unread, unread, partial: unread > 0, computedAt: '2026-11-24T10:00:00.000Z', groups,
})
const member = (vmid: number, name = `vm-${vmid}`, node = 'pve1') => ({ type: 'qemu' as const, vmid: String(vmid), node, name })

function props(overrides: Partial<React.ComponentProps<typeof SecurityGroupsPanel>> = {}) {
  return {
    securityGroups: GROUPS,
    vmFirewallData: [WEB_VM],
    loadingVMRules: false,
    guestsNotScanned: 0,
    clusterRules: [] as firewallAPIType.FirewallRule[],
    hostRulesByNode: {} as Record<string, firewallAPIType.FirewallRule[]>,
    firewallMode: 'cluster' as firewallAPIType.FirewallMode,
    selectedConnection: CONN,
    totalRules: 2,
    aliases: [{ name: 'net-mgmt', cidr: '10.99.99.0/24' }] as firewallAPIType.Alias[],
    ipsets: [] as firewallAPIType.IPSet[],
    reload: vi.fn(),
    loadGuestRules: vi.fn().mockResolvedValue([]),
    reloadVMFirewallRules: vi.fn().mockResolvedValue(undefined),
    groupUsage: usage() as GroupUsage | null,
    groupUsageLoading: false,
    reloadGroupUsage: vi.fn().mockResolvedValue(undefined),
    checkGroupUsage: vi.fn().mockResolvedValue(usage()),
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

/** The header row of a group, which carries the membership chips and actions. */
const sectionRow = (group: string) => screen.getAllByRole('row').find(r => within(r).queryByText(group))!

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
    expect(screen.getByText('· front tier')).toBeInTheDocument()
    expect(screen.getByText('2 rules')).toBeInTheDocument()
    expect(screen.getByText('0 rules')).toBeInTheDocument()

    // sg-web is referenced by web-01; the rules of every guest were read, so both counts are plain.
    expect(screen.getByText(/^1 VMs?$/)).toBeInTheDocument()
    expect(screen.getByText('0 VMs')).toBeInTheDocument()

    expect(screen.queryByText('https in')).not.toBeInTheDocument()
  })

  it('keeps membership on the group header, not as a per-rule column', () => {
    renderPanel()

    // The count belongs to the group, so repeating it on every rule row said
    // nothing; the column was dropped and this table now has the same eleven
    // columns as the other three.
    expect(screen.queryByText('Applied To')).not.toBeInTheDocument()
    expect(screen.getByText(/^1 VMs?$/)).toBeInTheDocument()
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

  it('confirms in a themed dialog before deleting a whole group, never a native confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')

    renderPanel()

    const section = screen.getAllByRole('row').find(r => within(r).queryByText('sg-web'))!

    fireEvent.click(within(section).getByRole('button', { name: 'Delete' }))

    const ask = await screen.findByRole('dialog')
    expect(within(ask).getByText('Delete Security Group "sg-web"?')).toBeInTheDocument()
    expect(within(ask).getByText('This cannot be undone: the group and its rules are deleted from the cluster.')).toBeInTheDocument()
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.deleteSecurityGroup).not.toHaveBeenCalled()

    fireEvent.click(within(section).getByRole('button', { name: 'Delete' }))
    const again = await screen.findByRole('dialog')
    // The guests are read first; no guest carries the group here.
    expect(await within(again).findByText('No guest carries this group')).toBeInTheDocument()
    fireEvent.click(within(again).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteSecurityGroup).toHaveBeenCalledWith(CONN, 'sg-web'))
    expect(confirmSpy).not.toHaveBeenCalled()
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

  it('flags a group a cluster rule references, which the guest count alone would call unused', () => {
    renderPanel({
      clusterRules: [
        { pos: 0, type: 'in', action: 'ACCEPT', enable: 1 },
        groupRule('sg-web', 1),
      ],
    })

    // "1 VMs" is true and yet incomplete: deleting sg-web would also drop a
    // cluster-wide rule, so the scope is shown next to the count.
    expect(within(sectionRow('sg-web')).getByText('Cluster')).toBeInTheDocument()

    // sg-db is referenced nowhere, so it carries no scope chip at all.
    expect(within(sectionRow('sg-db')).queryByText('Cluster')).not.toBeInTheDocument()
  })

  it('joins the cluster and node scopes of the chip tooltip with a middle dot, not a dash (D5)', async () => {
    renderPanel({ clusterRules: [groupRule('sg-web', 0)], hostRulesByNode: { pve1: [groupRule('sg-web')] } })

    fireEvent.mouseOver(within(sectionRow('sg-web')).getByText('Cluster'))

    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain(' · ')
    expect(tip.textContent).not.toContain('\u2014')
  })

  it('counts the nodes whose own rules reference the group', () => {
    renderPanel({
      hostRulesByNode: {
        pve2: [groupRule('sg-web')],
        pve1: [groupRule('sg-web')],
        pve3: [{ pos: 0, type: 'in', action: 'DROP', enable: 1 }],
      },
    })

    const section = sectionRow('sg-web')

    // Two nodes reference it, and no cluster rule does: the chip counts nodes.
    expect(within(section).getByText('2')).toBeInTheDocument()

    // The nodes are named in the tooltip, in a stable order.
    expect(within(section).getByLabelText('Referenced by node rules: pve1, pve2')).toBeInTheDocument()
  })

  it('opens the members dialog from the guest chip and refreshes the guests it changed', async () => {
    api.deleteVMRule.mockResolvedValue(undefined)

    const p = renderPanel()

    fireEvent.click(screen.getByText(/^1 VMs?$/))

    await waitFor(() => expect(screen.getByText('Members of sg-web')).toBeInTheDocument())

    const dialog = within(screen.getByRole('dialog'))

    fireEvent.click(dialog.getByRole('button', { name: 'Detach' }))

    await waitFor(() => expect(api.deleteVMRule).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', 100, 0))

    // Only the guest that actually changed is refetched, not the whole scan.
    await waitFor(() => expect(p.reloadVMFirewallRules).toHaveBeenCalledWith(WEB_VM))
    expect(p.reloadVMFirewallRules).toHaveBeenCalledTimes(1)

    fireEvent.click(dialog.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText('Members of sg-web')).not.toBeInTheDocument())
  })

  it('opens the same dialog from the group row action, on a group with no member', async () => {
    renderPanel()

    fireEvent.click(within(sectionRow('sg-db')).getByRole('button', { name: 'Members of sg-db' }))

    await waitFor(() => expect(screen.getByText('No guest references this group yet')).toBeInTheDocument())
  })

  it('holds the membership count back while the guest scan is still running', () => {
    renderPanel({ loadingVMRules: true })

    // A "0 VMs" shown mid-scan reads as "unused" on a group that may well be
    // in use, so the count waits.
    expect(screen.queryByText(/^1\+? VMs?$/)).not.toBeInTheDocument()
    expect(screen.getAllByText('…')).toHaveLength(GROUPS.length)
    expect(screen.getAllByRole('button', { name: 'Loading...' })).toHaveLength(GROUPS.length)
  })

  it('says the membership count is partial when the scan skipped guests', () => {
    renderPanel({ guestsNotScanned: 3 })

    expect(screen.getByRole('button', {
      name: /web-01 \(100\) · 3 guests were not scanned, this count may be incomplete$/,
    })).toBeInTheDocument()
  })

  it('lists the groups of a standalone node like those of a cluster', () => {
    renderPanel({ firewallMode: 'standalone' })

    // A single node has the same Datacenter firewall as a cluster, groups included.
    expect(screen.getByText('sg-web')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Policy' })).toBeInTheDocument()
  })

  it('offers to create the first group when the connection has none', () => {
    renderPanel({ securityGroups: [] })

    expect(screen.getByText('No Security Group')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    expect(screen.getByText('Create Security Group')).toBeInTheDocument()
  })
})

describe('SecurityGroupsPanel load error', () => {
  afterEach(cleanup)

  it('warns on top when the firewall data could not be loaded, and retries with reload', () => {
    const p = renderPanel({ loadError: 'HTTP 502' })

    expect(screen.getByText(/Some firewall data could not be loaded.*HTTP 502/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(p.reload).toHaveBeenCalledTimes(1)
  })

  it('warns when there is no group because the load failed, instead of offering to create the first one only', () => {
    renderPanel({ securityGroups: [], loadError: 'HTTP 502' })

    expect(screen.getByText(/Some firewall data could not be loaded/)).toBeInTheDocument()
  })

  it('shows nothing when it loaded', () => {
    renderPanel()

    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument()
  })
})

describe('SecurityGroupsPanel membership without every guest rules (UA44)', () => {
  afterEach(() => {
    cleanup()
    microseg.snapshot = null
    microseg.revisionLoading = false
  })

  const tagged = (vmid: number, tags: string[]): VMFirewallInfo => ({
    ...WEB_VM, vmid, name: `vm-${vmid}`, rules: [], rulesLoaded: false, tags,
  })
  const ZONE_GROUPS: firewallAPIType.SecurityGroup[] = [{ group: 'pcz-web', rules: [] }, { group: 'sg-db', rules: [] }]

  it('knows the members of a deployed zone group from the zone tags, without reading a rule', () => {
    microseg.snapshot = { tag_prefix: 'zone-', flows: [], zones: [{ id: 'z1', name: 'web', state: 'enforce' }] }
    const p = renderPanel({ securityGroups: ZONE_GROUPS, vmFirewallData: [tagged(1, ['zone-web']), tagged(2, ['Zone-Web']), tagged(3, ['zone-db'])] })

    expect(within(sectionRow('pcz-web')).getByText('2 VMs')).toBeInTheDocument()
    expect(within(sectionRow('sg-db')).getByText('0 VMs')).toBeInTheDocument()
    expect(p.loadGuestRules).not.toHaveBeenCalled()
    expect(api.getVMRules).not.toHaveBeenCalled()
  })

  it('shows a zone group count as pending, not "0 VMs", until the deployed revision is read (D6)', () => {
    microseg.snapshot = { tag_prefix: 'zone-', flows: [], zones: [{ id: 'z1', name: 'web', state: 'enforce' }] }
    microseg.revisionLoading = true
    const vms = [tagged(1, ['zone-web'])]
    renderPanel({ securityGroups: ZONE_GROUPS, vmFirewallData: vms })

    expect(within(sectionRow('pcz-web')).getByText('…')).toBeInTheDocument()
    expect(within(sectionRow('pcz-web')).queryByText('0 VMs')).not.toBeInTheDocument()
    // Not a zone group: its count does not wait on the revision.
    expect(within(sectionRow('sg-db')).getByText('0 VMs')).toBeInTheDocument()

    cleanup()
    microseg.revisionLoading = false
    renderPanel({ securityGroups: ZONE_GROUPS, vmFirewallData: vms })
    expect(within(sectionRow('pcz-web')).getByText(/^1 VMs?$/)).toBeInTheDocument()
  })

  it('does not take the tag of a disabled zone for a membership: only the rules read tell', () => {
    microseg.snapshot = { tag_prefix: 'zone-', flows: [], zones: [{ id: 'z1', name: 'web', state: 'disabled' }] }
    renderPanel({ securityGroups: ZONE_GROUPS, vmFirewallData: [tagged(1, ['zone-web'])] })

    expect(within(sectionRow('pcz-web')).getByText('0 VMs')).toBeInTheDocument()
  })

  it('says why the count is unknown in the chip tooltip', () => {
    renderPanel({ groupUsage: usage({}, 3) })

    expect(within(sectionRow('sg-web')).getByRole('button', { name: /^Proxmox keeps no member list/ })).toBeInTheDocument()
  })

  it('reads the rules of the one guest a detach needs when they were not read', async () => {
    microseg.snapshot = { tag_prefix: 'zone-', flows: [], zones: [{ id: 'z1', name: 'web', state: 'observe' }] }
    api.deleteVMRule.mockResolvedValue(undefined)
    const loadGuestRules = vi.fn().mockResolvedValue([groupRule('pcz-web', 3)])
    renderPanel({ securityGroups: ZONE_GROUPS, vmFirewallData: [tagged(7, ['zone-web']), tagged(8, [])], loadGuestRules })

    fireEvent.click(within(sectionRow('pcz-web')).getByText('1 VM'))
    await waitFor(() => expect(screen.getByText('Members of pcz-web')).toBeInTheDocument())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Detach' }))

    await waitFor(() => expect(api.deleteVMRule).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', 7, 3))
    expect(loadGuestRules).toHaveBeenCalledTimes(1)
  })

  describe('colours', () => {
    afterEach(() => { microseg.zones = [] })

    it('gives each group header a dot and a left border in its colour, the zone colour for pcz-<zone>', () => {
      microseg.zones = [{ name: 'web', color: '#8b5cf6' }]
      renderPanel({ securityGroups: [{ group: 'pcz-web', rules: [] }, { group: 'sg-db', rules: [] }] })

      const zoneHeader = screen.getByTestId('sg-header-pcz-web')
      expect(getComputedStyle(zoneHeader).borderLeftColor).toBe('rgb(139, 92, 246)')
      expect(getComputedStyle(screen.getByTestId('sg-dot-pcz-web')).backgroundColor).toBe('rgb(139, 92, 246)')
      expect(getComputedStyle(screen.getByTestId('sg-header-sg-db')).borderLeftColor).not.toBe('rgb(139, 92, 246)')
      expect(within(zoneHeader).getByText('pcz-web')).toBeInTheDocument()
    })
  })
})

describe('SecurityGroupsPanel zone groups count what the zone map counts', () => {
  afterEach(() => {
    cleanup()
    microseg.snapshot = null
    zoneGuests.guests = []
    zoneGuests.status = 'ready'
    zoneGuests.asked = []
  })

  const ZONES: firewallAPIType.SecurityGroup[] = [{ group: 'pcz-web', rules: [] }, { group: 'pcz-db', rules: [] }]
  const stale = (vmid: number, tags: string[]): VMFirewallInfo => ({ ...WEB_VM, vmid, name: `vm-${vmid}`, rules: [], rulesLoaded: false, tags })
  const deployed = () => { microseg.snapshot = { tag_prefix: 'zone-', flows: [], zones: [{ id: 'z1', name: 'web', state: 'observe' }, { id: 'z2', name: 'db', state: 'enforce' }] } }

  it('follows a guest moved to another zone although the inventory and the shared rules read still have it in the old one', () => {
    deployed()
    // Guest 921 was moved from web to db: the inventory tags and the rules read are from before the run.
    zoneGuests.guests = [{ type: 'qemu', vmid: 921, tags: ['zone-db'] }, { type: 'qemu', vmid: 922, tags: ['zone-web'] }]
    renderPanel({
      securityGroups: ZONES,
      vmFirewallData: [stale(921, ['zone-web']), stale(922, ['zone-web'])],
      groupUsage: usage({ 'pcz-web': [member(921), member(922)] }),
    })

    expect(within(sectionRow('pcz-web')).getByText('1 VM')).toBeInTheDocument()
    expect(within(sectionRow('pcz-db')).getByText('1 VM')).toBeInTheDocument()
    expect(zoneGuests.asked).toContain(CONN)
  })

  it('holds the zone counts back while the zone guests are read, and falls back to the inventory tags when they cannot be', () => {
    deployed()
    zoneGuests.status = 'loading'
    renderPanel({ securityGroups: ZONES, vmFirewallData: [stale(921, ['zone-web'])] })
    expect(within(sectionRow('pcz-web')).getByText('…')).toBeInTheDocument()

    cleanup()
    zoneGuests.status = 'error'
    renderPanel({ securityGroups: ZONES, vmFirewallData: [stale(921, ['zone-web'])] })
    expect(within(sectionRow('pcz-web')).getByText('1 VM')).toBeInTheDocument()
  })

  it('does not read the zone guests without a deployed revision', () => {
    renderPanel()

    expect(zoneGuests.asked.every(id => id === null)).toBe(true)
  })
})

describe('SecurityGroupsPanel membership from the rules the server read', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    api.deleteSecurityGroupRule.mockResolvedValue(undefined)
    api.deleteSecurityGroup.mockResolvedValue(undefined)
    api.deleteVMRule.mockResolvedValue(undefined)
  })

  /** A guest of the page whose rules were never read in the browser. */
  const unread = (vmid: number): VMFirewallInfo => ({ ...WEB_VM, vmid, name: `vm-${vmid}`, rules: [], rulesLoaded: false })

  it('counts the guests carrying a group although no row was opened', () => {
    renderPanel({ vmFirewallData: [unread(201), unread(202), unread(203)], groupUsage: usage({ 'sg-db': [member(201), member(203)] }) })

    expect(within(sectionRow('sg-db')).getByText('2 VMs')).toBeInTheDocument()
    expect(within(sectionRow('sg-db')).getByRole('button', { name: /vm-201 \(201\), vm-203 \(203\)/ })).toBeInTheDocument()
    expect(within(sectionRow('sg-web')).getByText('0 VMs')).toBeInTheDocument()
    expect(api.getVMRules).not.toHaveBeenCalled()
  })

  it('trusts the rules read in the page over the shared read: a guest just detached leaves the count', () => {
    const detached: VMFirewallInfo = { ...unread(201), rulesLoaded: true }
    renderPanel({ vmFirewallData: [detached, unread(202)], groupUsage: usage({ 'sg-db': [member(201), member(202)] }) })

    expect(within(sectionRow('sg-db')).getByText(/^1 VMs?$/)).toBeInTheDocument()
  })

  it('never reads "0 VMs" for a group whose guests could not all be read', () => {
    renderPanel({ vmFirewallData: [unread(201)], groupUsage: usage({ 'sg-db': [member(201)] }, 4) })

    expect(within(sectionRow('sg-db')).getByText('1+ VMs')).toBeInTheDocument()
    expect(within(sectionRow('sg-web')).getByText('VMs not counted')).toBeInTheDocument()
    expect(screen.queryByText('0 VMs')).not.toBeInTheDocument()
  })

  it('gives no count when the rules could not be read at all, and holds it back while they are read', () => {
    renderPanel({ vmFirewallData: [unread(201)], groupUsage: null })
    expect(screen.getAllByText('VMs not counted')).toHaveLength(GROUPS.length)

    cleanup()
    renderPanel({ vmFirewallData: [unread(201)], groupUsage: null, groupUsageLoading: true })
    expect(screen.getAllByText('…')).toHaveLength(GROUPS.length)
  })

  it('asks the server for rules read again when Refresh is pressed', () => {
    const p = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(p.reload).toHaveBeenCalled()
    expect(p.reloadGroupUsage).toHaveBeenCalledWith(true)
  })

  describe('deleting a group', () => {
    const openDelete = (group: string) => fireEvent.click(within(sectionRow(group)).getByRole('button', { name: 'Delete' }))

    it('reads every guest, lists those carrying the group, detaches them, deletes its rules then the group', async () => {
      const calls: string[] = []
      api.getVMRules.mockImplementation(async (_c: string, _n: string, _t: string, vmid: number) => (
        vmid === 201 ? [groupRule('sg-web', 0), { pos: 1, type: 'in', action: 'ACCEPT' }, groupRule('sg-web', 2)] : [groupRule('sg-web', 4)]
      ))
      api.deleteVMRule.mockImplementation(async (_c: string, _n: string, _t: string, vmid: number, pos: number) => { calls.push(`guest ${vmid} rule ${pos}`) })
      api.deleteSecurityGroupRule.mockImplementation(async (_c: string, group: string, pos: number) => { calls.push(`${group} rule ${pos}`) })
      api.deleteSecurityGroup.mockImplementation(async (_c: string, group: string) => { calls.push(`group ${group}`) })
      let answer: (u: GroupUsage) => void = () => undefined
      const checkGroupUsage = vi.fn().mockReturnValue(new Promise<GroupUsage>(resolve => { answer = resolve }))
      const p = renderPanel({ vmFirewallData: [unread(201), unread(202)], checkGroupUsage })

      openDelete('sg-web')
      const ask = await screen.findByRole('dialog')
      expect(within(ask).getByText(/Reading the rules of the guests/)).toBeInTheDocument()
      expect(within(ask).getByRole('button', { name: 'Delete' })).toBeDisabled()
      expect(within(ask).getByRole('button', { name: 'Cancel' })).toBeEnabled()
      answer(usage({ 'sg-web': [member(201, 'app-01'), member(202, 'app-02', 'pve2')] }))

      // Each guest on one line with its glyphs: type icon and state dot, name, VMID, then the Proxmox logo and the node.
      const first = await within(ask).findByTestId('guest-line-qemu-201')
      expect(first).toHaveTextContent('app-01#201pve1')
      expect(first.querySelector('img[src*="proxmox-logo"]')).not.toBeNull()
      expect(within(ask).getByTestId('guest-line-qemu-202')).toHaveTextContent('app-02#202pve2')
      fireEvent.click(within(ask).getByRole('button', { name: 'Detach from 2 guests and delete' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      // Last position first on a guest carrying the group twice, the guests before the group's own rules, the group last.
      expect(calls).toEqual(['guest 201 rule 2', 'guest 201 rule 0', 'guest 202 rule 4', 'sg-web rule 1', 'sg-web rule 0', 'group sg-web'])
      expect(checkGroupUsage).toHaveBeenCalledTimes(1)
      expect(p.reload).toHaveBeenCalled()
      expect(p.reloadGroupUsage).toHaveBeenCalled()
      expect(p.reloadVMFirewallRules).toHaveBeenCalledTimes(2)
    })

    it('keeps the group when a guest could not be detached, and says which', async () => {
      api.getVMRules.mockRejectedValue(new Error('pve said no'))
      renderPanel({ checkGroupUsage: vi.fn().mockResolvedValue(usage({ 'sg-web': [member(201, 'app-01')] })) })

      openDelete('sg-web')
      fireEvent.click(await screen.findByRole('button', { name: 'Detach from 1 guest and delete' }))

      expect(await screen.findByText('app-01 (201) · pve1 could not be detached: the group was not deleted')).toBeInTheDocument()
      expect(api.deleteSecurityGroupRule).not.toHaveBeenCalled()
      expect(api.deleteSecurityGroup).not.toHaveBeenCalled()
    })

    it('counts the guests beyond the first five on one line, and warns about those it could not check', async () => {
      const many = Array.from({ length: 8 }, (_, i) => member(300 + i))
      renderPanel({ checkGroupUsage: vi.fn().mockResolvedValue(usage({ 'sg-db': many }, 2)) })

      openDelete('sg-db')
      const ask = await screen.findByRole('dialog')

      expect(await within(ask).findByText('and 3 more')).toBeInTheDocument()
      expect(within(ask).getByTestId('guest-line-qemu-304')).toBeInTheDocument()
      expect(within(ask).queryByTestId('guest-line-qemu-305')).not.toBeInTheDocument()
      expect(within(ask).getByText('2 guests could not be checked and may still carry the group')).toBeInTheDocument()
      expect(within(ask).getByRole('button', { name: 'Detach from 8 guests and delete' })).toBeEnabled()
    })

    it('keeps a group a cluster rule or a node rule still uses', async () => {
      renderPanel({ clusterRules: [groupRule('sg-web')], hostRulesByNode: { pve2: [groupRule('sg-web')] } })

      openDelete('sg-web')
      const ask = await screen.findByRole('dialog')

      expect(within(ask).getByText('A cluster rule still uses this group: remove that rule first')).toBeInTheDocument()
      expect(within(ask).getByText('Rules of pve2 still use this group: remove them first')).toBeInTheDocument()
      await within(ask).findByText('No guest carries this group')
      expect(within(ask).getByRole('button', { name: 'Delete' })).toBeDisabled()
    })

    it('reads the rules of the nodes itself: a group a node names is kept even when the page never loaded them', async () => {
      vi.mocked(api.getNodeRules).mockImplementation(async (_conn, node) => (node === 'pve2' ? [groupRule('sg-db')] : []))
      renderPanel({ nodeStatus: { pve1: 'online', pve2: 'online' } })

      openDelete('sg-db')
      const ask = await screen.findByRole('dialog')

      expect(await within(ask).findByText('Rules of pve2 still use this group: remove them first')).toBeInTheDocument()
      expect(api.getNodeRules).toHaveBeenCalledWith(CONN, 'pve1')
      expect(within(ask).getByRole('button', { name: 'Delete' })).toBeDisabled()
    })

    it('says which nodes could not be read, without holding the deletion', async () => {
      vi.mocked(api.getNodeRules).mockImplementation(async (_conn, node) => {
        if (node === 'pve3') throw new Error('offline')

        return []
      })
      renderPanel({ nodeStatus: { pve1: 'online', pve3: 'offline' } })

      openDelete('sg-db')
      const ask = await screen.findByRole('dialog')

      expect(await within(ask).findByText('The rules of pve3 could not be read and may still use the group')).toBeInTheDocument()
      expect(within(ask).getByRole('button', { name: 'Delete' })).toBeEnabled()
    })

    it('keeps the group when the guests could not be checked, and checks again on Retry', async () => {
      const checkGroupUsage = vi.fn().mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue(usage())
      renderPanel({ checkGroupUsage })

      openDelete('sg-db')
      const ask = await screen.findByRole('dialog')

      expect(await within(ask).findByText('The guests could not be checked, so the group is kept')).toBeInTheDocument()
      expect(within(ask).getByText('HTTP 500')).toBeInTheDocument()
      expect(within(ask).getByRole('button', { name: 'Delete' })).toBeDisabled()
      fireEvent.click(within(ask).getByRole('button', { name: 'Retry' }))

      expect(await within(ask).findByText('No guest carries this group')).toBeInTheDocument()
      fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(api.deleteSecurityGroup).toHaveBeenCalledWith(CONN, 'sg-db'))
    })

    it('shows only the answer of the check asked last', async () => {
      let failFirst: (e: Error) => void = () => undefined
      const first = vi.fn(() => new Promise<GroupUsage>((_resolve, reject) => { failFirst = reject }))
      const second = vi.fn().mockResolvedValue(usage())
      const dialog = (check: () => Promise<GroupUsage>) => (
        <DeleteSecurityGroupDialog groupName='sg-db' connectionId={CONN} rules={[]} scope={{ cluster: false, nodes: [] }} nodes={NO_NODES} check={check} onClose={vi.fn()} onDeleted={vi.fn()} />
      )
      const { rerender } = renderWithProviders(dialog(first))

      await waitFor(() => expect(first).toHaveBeenCalled())
      // Another check is asked while the first still runs (what the double effect of development does).
      rerender(dialog(second))
      expect(await screen.findByText('No guest carries this group')).toBeInTheDocument()
      failFirst(new Error('aborted'))
      await Promise.resolve()

      expect(screen.queryByText('The guests could not be checked, so the group is kept')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
    })

    it('shows what Proxmox answered when the deletion itself fails', async () => {
      api.deleteSecurityGroup.mockRejectedValue(new Error('group is locked'))
      renderPanel()

      openDelete('sg-db')
      const ask = await screen.findByRole('dialog')
      await within(ask).findByText('No guest carries this group')
      fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }))

      expect(await within(ask).findByText('group is locked')).toBeInTheDocument()
    })
  })

  describe('rules naming a group that no longer exists', () => {
    const orphaned = () => usage({ 'la-test-01': [member(103, 'VMTest3')], gone: [member(103, 'VMTest3'), member(104, 'other')], 'sg-web': [member(100, 'web-01')] })

    it('says how many guests still name a deleted group, and which groups', () => {
      renderPanel({ groupUsage: orphaned() })

      expect(within(screen.getByTestId('sg-orphans')).getByText('2 guests still name a security group that no longer exists: gone, la-test-01')).toBeInTheDocument()
    })

    it('shows nothing when every group named exists', () => {
      renderPanel({ groupUsage: usage({ 'sg-web': [member(100, 'web-01')] }) })

      expect(screen.queryByTestId('sg-orphans')).not.toBeInTheDocument()
    })

    it('removes those rules from each guest once confirmed, then reads the usage again', async () => {
      api.getVMRules.mockImplementation(async (_c: string, _n: string, _t: string, vmid: number) => (vmid === 103 ? [groupRule('la-test-01', 0), groupRule('gone', 1)] : [groupRule('gone', 5)]))
      const p = renderPanel({ groupUsage: orphaned() })

      fireEvent.click(within(screen.getByTestId('sg-orphans')).getByRole('button', { name: 'Remove these references' }))
      const ask = await screen.findByRole('dialog')
      expect(within(ask).getAllByTestId('guest-line-qemu-103').map(l => l.textContent)).toEqual(['VMTest3#103pve1gone', 'VMTest3#103pve1la-test-01'])
      expect(within(ask).getAllByTestId('guest-line-qemu-103')[0].querySelector('img[src*="proxmox-logo"]')).not.toBeNull()
      fireEvent.click(within(ask).getByRole('button', { name: 'Remove these references' }))

      await waitFor(() => expect(p.reloadGroupUsage).toHaveBeenCalled())
      expect(api.deleteVMRule.mock.calls.map(c => `${c[3]}:${c[4]}`)).toEqual(['103:1', '104:5', '103:0'])
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('keeps the dialog open with the error when a removal fails', async () => {
      api.getVMRules.mockRejectedValue(new Error('node unreachable'))
      renderPanel({ groupUsage: orphaned() })

      fireEvent.click(within(screen.getByTestId('sg-orphans')).getByRole('button', { name: 'Remove these references' }))
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove these references' }))

      expect(await screen.findByText('node unreachable')).toBeInTheDocument()
    })
  })
})
