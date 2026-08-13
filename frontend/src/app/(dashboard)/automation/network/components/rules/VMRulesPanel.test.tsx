/**
 * Component tests for VMRulesPanel.tsx — the VM/CT firewall rules table.
 *
 * The panel nests two levels of grouping the other rules tables do not have:
 * guests are grouped by their primary VLAN, and each guest is itself a
 * collapsible section. Both must be open before a rule row is on screen,
 * which is what most of these tests walk through. The VLAN grouping order is
 * asserted too (numbered VLANs ascending, untagged last), since it is
 * computed rather than given by the caller.
 *
 * Everything else is prop-driven, so only the firewall API module is
 * stubbed, plus the raw `fetch` PUT used for reordering, which MSW serves.
 * The jsdom setup errors on unhandled requests, so a route called without a
 * fixture fails the test.
 *
 * `scrollIntoView` is stubbed because the log dialog auto-scrolls to its
 * last line on every log update and jsdom implements no layout — the same
 * stub VmFirewallTab.test.tsx needs, kept local for the same reason.
 *
 * The VM rule dialog labels its fields directly (no next-intl), and its
 * Selects carry an InputLabel but no `labelId`, so their combobox has no
 * accessible name and is located from the rendered label element — same
 * limitation as LogLevelSelect.test.tsx.
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
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import type * as firewallAPIType from '@/lib/api/firewall'
import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

vi.mock('@/lib/api/firewall', () => ({
  toggleVMNICFirewall: vi.fn(),
  updateVMOptions: vi.fn(),
  addVMRule: vi.fn(),
  updateVMRule: vi.fn(),
  deleteVMRule: vi.fn(),
  getVMFirewallLog: vi.fn(),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import * as firewallAPI from '@/lib/api/firewall'

import VMRulesPanel from './VMRulesPanel'

const api = firewallAPI as unknown as Record<string, ReturnType<typeof vi.fn>>

const CONN = 'conn-1'

// The log dialog auto-scrolls to its last line; jsdom has no layout, so
// scrollIntoView does not exist there.
Element.prototype.scrollIntoView ??= vi.fn()

/** A rule where every optional PVE field is set. */
const FULL_RULE: firewallAPIType.FirewallRule = {
  pos: 0, type: 'in', action: 'ACCEPT', enable: 1,
  proto: 'tcp', dport: '443', sport: '1024:65535',
  source: '10.0.0.0/8', dest: '10.0.0.5', macro: '',
  iface: 'net0', log: 'warning', comment: 'https in',
}

/** A rule as PVE returns it when nothing optional was configured. */
const BARE_RULE: firewallAPIType.FirewallRule = { pos: 1, type: '', action: '' }

const WEB: VMFirewallInfo = {
  vmid: 100, name: 'web-01', node: 'pve1', type: 'qemu', status: 'running',
  firewallEnabled: true, rules: [FULL_RULE, BARE_RULE],
  options: { enable: 1, policy_in: 'DROP', policy_out: 'ACCEPT', log_level_in: 'info', log_level_out: 'nolog' },
  vlans: [20],
}

const DB: VMFirewallInfo = {
  vmid: 101, name: 'db-01', node: 'pve2', type: 'lxc', status: 'running',
  firewallEnabled: false, rules: [], options: null, vlans: [],
}

const ALIASES: firewallAPIType.Alias[] = [{ name: 'net-mgmt', cidr: '10.99.99.0/24' }]
const IPSETS: firewallAPIType.IPSet[] = [{ name: 'trusted', members: [{ cidr: '1.2.3.4' }] }]

const SECURITY_GROUPS: firewallAPIType.SecurityGroup[] = [
  { group: 'sg-web', comment: 'front tier', rules: [] },
  { group: 'sg-db', rules: [] },
]

function props(overrides: Partial<React.ComponentProps<typeof VMRulesPanel>> = {}) {
  return {
    vmFirewallData: [WEB, DB],
    securityGroups: SECURITY_GROUPS,
    loadingVMRules: false,
    selectedConnection: CONN,
    loadVMFirewallData: vi.fn().mockResolvedValue(undefined),
    reloadVMFirewallRules: vi.fn().mockResolvedValue(undefined),
    aliases: ALIASES,
    ipsets: IPSETS,
    ...overrides,
  }
}

function renderPanel(overrides: Parameters<typeof props>[0] = {}) {
  const p = props(overrides)

  renderWithProviders(<VMRulesPanel {...p} />)

  return p
}

/** A Select inside an open dialog, found from its rendered label. */
function selectByLabel(label: string) {
  const el = screen.queryAllByText(label).find(n => n.tagName === 'LABEL')

  if (!el?.parentElement) throw new Error(`No Select labelled "${label}"`)

  return within(el.parentElement).getByRole('combobox')
}

/** Open the VLAN group, then the guest section, so its rule rows render. */
function expandTo(vmName: string, vlanLabel: string) {
  fireEvent.click(screen.getByText(vlanLabel))
  fireEvent.click(screen.getByText(vmName))
}

/** The table row of a guest's section header. */
const rowOf = (text: string) => screen.getAllByRole('row').find(r => within(r).queryByText(text))!

/**
 * Wait for the rule dialog to mount. Its title text sits in a Box inside the
 * DialogTitle rather than directly in the h2, so it is not addressable by
 * selector; only one dialog of this panel is ever open at a time.
 */
const waitForRuleDialog = () =>
  waitFor(() => expect(within(screen.getByRole('dialog')).getByLabelText('Source')).toBeInTheDocument())

describe('VMRulesPanel', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    api.toggleVMNICFirewall.mockResolvedValue(undefined)
    api.updateVMOptions.mockResolvedValue(undefined)
    api.addVMRule.mockResolvedValue(undefined)
    api.updateVMRule.mockResolvedValue(undefined)
    api.deleteVMRule.mockResolvedValue(undefined)
    api.getVMFirewallLog.mockResolvedValue([])
  })

  it('groups guests by their primary VLAN, untagged last', () => {
    renderPanel()

    const vlanLabels = screen.getAllByRole('row')
      .map(r => r.textContent || '')
      .filter(txt => txt.includes('VLAN 20') || txt.includes('Untagged'))

    expect(vlanLabels[0]).toContain('VLAN 20')
    expect(vlanLabels[1]).toContain('Untagged')

    // Guests stay hidden until their VLAN group is opened.
    expect(screen.queryByText('web-01')).not.toBeInTheDocument()
    expect(screen.getAllByText('1 VM')).toHaveLength(2)
    expect(screen.getByText('2 rules total')).toBeInTheDocument()
    expect(screen.getByText('2/2 VMs • 1 protected')).toBeInTheDocument()
  })

  it('reveals a guest, then its rules with their log level', () => {
    renderPanel()

    fireEvent.click(screen.getByText('VLAN 20'))
    expect(screen.getByText('web-01')).toBeInTheDocument()

    // The guest is still collapsed at this point.
    expect(screen.queryByText('https in')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('web-01'))
    expect(screen.getByText('https in')).toBeInTheDocument()
    expect(screen.getByText('warning')).toBeInTheDocument()
    expect(screen.getByText('TCP/443')).toBeInTheDocument()
  })

  it('offers to create a rule on a guest that has none', () => {
    renderPanel()

    expandTo('db-01', 'Untagged')

    const emptyRow = screen.getAllByRole('row').find(r => within(r).queryByText('No rule configured'))!

    fireEvent.click(within(emptyRow).getByRole('button', { name: 'Add rule' }))

    expect(screen.getByText('db-01 (101)')).toBeInTheDocument()
  })

  it('expands and collapses every VLAN and guest at once', () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText('https in')).toBeInTheDocument()
    expect(screen.getByText('No rule configured')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('web-01')).not.toBeInTheDocument()
  })

  it('searches guests by name, id, node and VLAN', () => {
    renderPanel()

    const search = screen.getByPlaceholderText('Search VM...')

    fireEvent.change(search, { target: { value: 'db' } })
    expect(screen.getByText('Untagged')).toBeInTheDocument()
    expect(screen.queryByText('VLAN 20')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '20' } })
    expect(screen.getByText('VLAN 20')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'pve2' } })
    expect(screen.getByText('Untagged')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'nothing' } })
    expect(screen.getByText('No VM found')).toBeInTheDocument()
  })

  it('toggles a guest NIC firewall from its section switch', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('VLAN 20'))

    fireEvent.click(within(rowOf('web-01')).getByRole('switch'))

    await waitFor(() => expect(api.toggleVMNICFirewall).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', 100, false))
  })

  it('changes a guest inbound policy from its section select', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('VLAN 20'))

    const row = rowOf('web-01')
    const inPolicy = within(row).getAllByRole('combobox')[0]

    expect(inPolicy).toHaveTextContent('DROP')

    fireEvent.mouseDown(inPolicy)
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'REJECT' }))

    await waitFor(() => expect(api.updateVMOptions).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', 100, { policy_in: 'REJECT' }))
  })

  it('toggles a rule Active switch through updateVMRule', async () => {
    renderPanel()
    expandTo('web-01', 'VLAN 20')

    const row = screen.getAllByRole('row').find(r => within(r).queryByText('https in'))!

    fireEvent.click(within(row).getByRole('switch'))

    await waitFor(() => expect(api.updateVMRule).toHaveBeenCalledTimes(1))
    expect(api.updateVMRule.mock.calls[0].slice(0, 5)).toEqual([CONN, 'pve1', 'qemu', 100, 0])
    expect(api.updateVMRule.mock.calls[0][5]).toMatchObject({ enable: 0, log: 'warning' })
  })

  it('pre-fills the edit dialog from the rule, log level included', async () => {
    renderPanel()
    expandTo('web-01', 'VLAN 20')

    const row = screen.getAllByRole('row').find(r => within(r).queryByText('https in'))!

    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByText('Edit rule')).toBeInTheDocument())

    const dialog = within(screen.getByRole('dialog'))

    expect(dialog.getByLabelText('Source')).toHaveValue('10.0.0.0/8')
    expect(dialog.getByLabelText('Destination')).toHaveValue('10.0.0.5')
    expect(dialog.getByLabelText('Port destination')).toHaveValue('443')
    expect(dialog.getByLabelText('Port source')).toHaveValue('1024:65535')
    expect(dialog.getByLabelText('Interface')).toHaveValue('net0')
    expect(dialog.getByLabelText('Commentaire')).toHaveValue('https in')
    expect(selectByLabel('Log level')).toHaveTextContent('warning')
  })

  it('opens an empty add-rule dialog and saves the picked log level', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('VLAN 20'))

    fireEvent.click(within(rowOf('web-01')).getByRole('button', { name: 'Add rule' }))
    await waitForRuleDialog()

    const dialog = within(screen.getByRole('dialog'))

    // Every optional field starts empty on a new rule.
    expect(dialog.getByLabelText('Source')).toHaveValue('')
    expect(dialog.getByLabelText('Interface')).toHaveValue('')
    expect(selectByLabel('Log level')).toHaveTextContent('nolog')

    fireEvent.mouseDown(selectByLabel('Log level'))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'crit' }))

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(api.addVMRule).toHaveBeenCalledTimes(1))
    expect(api.addVMRule.mock.calls[0][4]).toMatchObject({ log: 'crit', type: 'in', action: 'ACCEPT' })
  })

  it('swaps the Action choices for the security groups on a GROUP rule', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('VLAN 20'))
    fireEvent.click(within(rowOf('web-01')).getByRole('button', { name: 'Add rule' }))
    await waitForRuleDialog()

    fireEvent.mouseDown(selectByLabel('Action'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent))
      .toEqual(['ACCEPT', 'DROP', 'REJECT'])
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })

    fireEvent.mouseDown(selectByLabel('Direction'))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'GROUP' }))

    // PVE carries the group name in `action` for a GROUP rule, so offering
    // ACCEPT/DROP/REJECT there could only produce an invalid rule.
    fireEvent.mouseDown(selectByLabel('Action'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent))
      .toEqual(['sg-web', 'sg-db'])
  })

  it('edits the dialog fields, including source through the suggestions', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('VLAN 20'))
    fireEvent.click(within(rowOf('web-01')).getByRole('button', { name: 'Add rule' }))
    await waitForRuleDialog()

    const dialog = within(screen.getByRole('dialog'))
    const source = dialog.getByLabelText('Source')

    fireEvent.change(source, { target: { value: 'net' } })
    fireEvent.click(await screen.findByRole('option', { name: /net-mgmt/ }))
    expect(source).toHaveValue('net-mgmt')

    fireEvent.change(dialog.getByLabelText('Destination'), { target: { value: '10.0.0.9' } })
    fireEvent.change(dialog.getByLabelText('Interface'), { target: { value: 'net1' } })
    fireEvent.change(dialog.getByLabelText('Port destination'), { target: { value: '8006' } })
    fireEvent.change(dialog.getByLabelText('Port source'), { target: { value: '1024' } })
    fireEvent.change(dialog.getByLabelText('Commentaire'), { target: { value: 'from test' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(api.addVMRule).toHaveBeenCalledTimes(1))
    expect(api.addVMRule.mock.calls[0][4]).toMatchObject({
      source: 'net-mgmt', dest: '10.0.0.9', iface: 'net1', dport: '8006', sport: '1024', comment: 'from test',
    })
  })

  it('clears the protocol when a macro is picked, and disables the port fields', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('VLAN 20'))
    fireEvent.click(within(rowOf('web-01')).getByRole('button', { name: 'Add rule' }))
    await waitForRuleDialog()

    const dialog = within(screen.getByRole('dialog'))

    fireEvent.mouseDown(selectByLabel('Protocole'))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'TCP' }))
    expect(selectByLabel('Protocole')).toHaveTextContent('TCP')

    fireEvent.mouseDown(selectByLabel('Macro'))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'SSH' }))

    // A macro carries its own ports, so the protocol is reset and the port
    // fields go read-only rather than silently conflicting with it.
    expect(selectByLabel('Macro')).toHaveTextContent('SSH')
    expect(dialog.getByLabelText('Port destination')).toBeDisabled()
    expect(dialog.getByLabelText('Port source')).toBeDisabled()
  })

  it('flips the Enabled switch of the rule dialog', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('VLAN 20'))
    fireEvent.click(within(rowOf('web-01')).getByRole('button', { name: 'Add rule' }))
    await waitForRuleDialog()

    const toggle = within(screen.getByRole('dialog')).getByRole('switch')

    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(api.addVMRule).toHaveBeenCalledTimes(1))
    expect(api.addVMRule.mock.calls[0][4]).toMatchObject({ enable: 0 })
  })

  it('saves an edited rule against its position', async () => {
    renderPanel()
    expandTo('web-01', 'VLAN 20')

    const row = screen.getAllByRole('row').find(r => within(r).queryByText('https in'))!

    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByText('Edit rule')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.updateVMRule).toHaveBeenCalledTimes(1))
    expect(api.updateVMRule.mock.calls[0][4]).toBe(0)
    expect(api.updateVMRule.mock.calls[0][5]).toMatchObject({ log: 'warning', comment: 'https in' })
  })

  it('confirms before deleting a rule, then deletes it', async () => {
    renderPanel()
    expandTo('web-01', 'VLAN 20')

    const row = screen.getAllByRole('row').find(r => within(r).queryByText('https in'))!

    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByText('Are you sure you want to delete this rule?')).toBeInTheDocument())
    expect(within(screen.getByRole('dialog')).getByText(/web-01/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteVMRule).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', 100, 0))
  })

  it('shows the firewall log of a guest and its two log-level pickers', async () => {
    api.getVMFirewallLog.mockResolvedValue([{ n: 1, t: 'DROP IN 10.0.0.1' }])
    renderPanel()
    fireEvent.click(screen.getByText('VLAN 20'))

    fireEvent.click(within(rowOf('web-01')).getByRole('button', { name: 'Firewall Logs' }))

    await waitFor(() => expect(screen.getByText('DROP IN 10.0.0.1')).toBeInTheDocument())
    expect(api.getVMFirewallLog).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', 100, 200)

    // The guest's stored levels drive the two selects.
    const logIn = within(screen.getByText('Log IN:').parentElement!).getByRole('combobox')

    expect(logIn).toHaveTextContent('info')

    fireEvent.mouseDown(logIn)
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'debug' }))

    await waitFor(() => expect(api.updateVMOptions).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', 100, { log_level_in: 'debug' }))
  })

  it('says so when a guest has no firewall log line', async () => {
    renderPanel()
    fireEvent.click(screen.getByText('Untagged'))

    fireEvent.click(within(rowOf('db-01')).getByRole('button', { name: 'Firewall Logs' }))

    await waitFor(() => expect(screen.getByText('No firewall log entries')).toBeInTheDocument())

    // A guest with no options falls back to PVE's own default level.
    expect(within(screen.getByText('Log OUT:').parentElement!).getByRole('combobox')).toHaveTextContent('nolog')
  })

  it('reorders a rule by dropping it on another row', async () => {
    renderPanel()
    expandTo('web-01', 'VLAN 20')

    const requests: Request[] = []

    server.use(
      http.put(`*/api/v1/firewall/vms/${CONN}/pve1/qemu/100/rules/0`, ({ request }) => {
        requests.push(request.clone())

        return HttpResponse.json({})
      }),
    )

    const from = screen.getAllByRole('row').find(r => within(r).queryByText('https in'))!
    const to = screen.getAllByRole('row').find(r => within(r).queryByText('1') && r !== from)!
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: () => '0' }

    fireEvent.dragStart(from, { dataTransfer })

    fireEvent.dragOver(to, { dataTransfer })
    fireEvent.drop(to, { dataTransfer })

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(await requests[0].json()).toEqual({ moveto: 1 })
  })

  it('shows a progress bar instead of the table while the rules load', () => {
    renderPanel({ loadingVMRules: true })

    expect(screen.getByText('Loading firewall rules...')).toBeInTheDocument()
    expect(screen.queryByText('VLAN 20')).not.toBeInTheDocument()
  })

  it('offers to load the guests when there are none', () => {
    const p = renderPanel({ vmFirewallData: [] })

    expect(screen.getByText('No VM found')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load VMs' }))
    expect(p.loadVMFirewallData).toHaveBeenCalled()
  })
})
