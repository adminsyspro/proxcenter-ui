/**
 * Component tests for VmFirewallTab.tsx — the add-rule payload must carry the
 * log level.
 *
 * The tab does not submit the dialog's draft rule as-is: it rebuilds the
 * payload field by field before handing it to the shared state hook. Any
 * field missing from that literal is silently dropped, which is exactly how
 * the log level picked by the user used to be lost. So the assertions here
 * are on the object handed to `addVMRule`, not on the dialog's own state
 * (that round trip is covered in FirewallDialogs.test.tsx).
 *
 * The tab fetches on mount: the firewall API module is mocked wholesale, and
 * the one raw `fetch` it does — the guest config, used to build the NIC
 * table — is served by MSW. The jsdom setup errors on unhandled requests, so
 * a missing fixture fails the test rather than yielding empty data.
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

vi.mock('@/lib/api/firewall', () => ({
  getVMOptions: vi.fn(),
  getVMRules: vi.fn(),
  getSecurityGroups: vi.fn(),
  updateVMOptions: vi.fn(),
  addVMRule: vi.fn(),
  updateVMRule: vi.fn(),
  deleteVMRule: vi.fn(),
  getAliases: vi.fn(),
  getIPSets: vi.fn(),
  getVMFirewallLog: vi.fn(),
}))

import * as firewallAPI from '@/lib/api/firewall'

import VmFirewallTab from './VmFirewallTab'

const CONN_ID = 'conn-1'
const NODE = 'pve1'
const VMID = 100

const PROPS = { connectionId: CONN_ID, node: NODE, vmType: 'qemu' as const, vmid: VMID, vmName: 'web-01' }

const api = firewallAPI as unknown as Record<string, ReturnType<typeof vi.fn>>

// The log dialog auto-scrolls to its last line; jsdom implements no layout, so
// scrollIntoView does not exist there. Stubbed locally rather than in the
// shared jsdom setup, since only this component needs it.
Element.prototype.scrollIntoView ??= vi.fn()

const LOG_LABEL = 'Log level'

/** The Log level Select inside the open add-rule dialog, found from its label. */
function logLevel() {
  const label = screen.queryAllByText(LOG_LABEL).find(el => el.tagName === 'LABEL')

  if (!label?.parentElement) throw new Error('Log level select not rendered')

  return within(label.parentElement).getByRole('combobox')
}

function seedConfig(config: Record<string, unknown> = { net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,firewall=1' }) {
  server.use(
    http.get(`*/api/v1/connections/${CONN_ID}/guests/qemu/${NODE}/${VMID}/config`, () =>
      HttpResponse.json(config),
    ),
  )
}

/** Render and wait for the mount fetches to settle into the rules table. */
async function renderTab() {
  renderWithProviders(<VmFirewallTab {...PROPS} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add rule' })).toBeInTheDocument())
}

/** Open the add-rule dialog and wait for its Log level picker. */
async function openAddRuleDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
  await waitFor(() => expect(screen.getByText('Add rule', { selector: 'h2' })).toBeInTheDocument())
}

const submitAddRule = () => fireEvent.click(screen.getByRole('button', { name: 'Add' }))

describe('VmFirewallTab', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    api.getVMOptions.mockResolvedValue({ enable: 1, policy_in: 'DROP', policy_out: 'ACCEPT', log_level_in: 'nolog', log_level_out: 'nolog' })
    api.getVMRules.mockResolvedValue([
      { pos: 0, type: 'in', action: 'ACCEPT', enable: 1, proto: 'tcp', dport: '22', log: 'warning', comment: 'ssh' },
    ])
    api.getSecurityGroups.mockResolvedValue([{ group: 'webserver' }])
    api.getAliases.mockResolvedValue([{ name: 'web-front', cidr: '10.0.0.0/24' }])
    api.getIPSets.mockResolvedValue([{ name: 'blocklist', members: [{ cidr: '1.2.3.4' }] }])
    api.addVMRule.mockResolvedValue(undefined)
    api.updateVMRule.mockResolvedValue(undefined)
    api.updateVMOptions.mockResolvedValue(undefined)
    api.getVMFirewallLog.mockResolvedValue([])
    seedConfig()
  })

  it('sends the default log level when the user does not touch the picker', async () => {
    await renderTab()
    await openAddRuleDialog()

    expect(logLevel()).toHaveTextContent('nolog')

    submitAddRule()

    await waitFor(() => expect(api.addVMRule).toHaveBeenCalledTimes(1))

    // The full payload, so a field silently dropped from the literal fails
    // here too. `log` is never an empty string: PVE's default is "nolog".
    expect(api.addVMRule).toHaveBeenCalledWith(CONN_ID, NODE, 'qemu', VMID, {
      type: 'in',
      action: 'ACCEPT',
      enable: 1,
      proto: undefined,
      dport: undefined,
      source: undefined,
      dest: undefined,
      log: 'nolog',
      comment: undefined,
    })
  })

  it('sends the level the user picked (the field this PR stopped dropping)', async () => {
    await renderTab()
    await openAddRuleDialog()

    fireEvent.mouseDown(logLevel())
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'crit' }))

    expect(logLevel()).toHaveTextContent('crit')

    submitAddRule()

    await waitFor(() => expect(api.addVMRule).toHaveBeenCalledTimes(1))
    expect(api.addVMRule.mock.calls[0][4]).toMatchObject({ log: 'crit', type: 'in', action: 'ACCEPT' })
  })

  it('drops "any" from source and dest while keeping the log level', async () => {
    await renderTab()
    await openAddRuleDialog()

    // Source/dest are Autocompletes here (aliases + ipsets are loaded)
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'any' } })
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: '10.0.0.9' } })

    fireEvent.mouseDown(logLevel())
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'info' }))

    submitAddRule()

    await waitFor(() => expect(api.addVMRule).toHaveBeenCalledTimes(1))
    expect(api.addVMRule.mock.calls[0][4]).toMatchObject({ source: undefined, dest: '10.0.0.9', log: 'info' })
  })

  it('shows the rule log level in the table', async () => {
    await renderTab()
    expect(screen.getByText('warning')).toBeInTheDocument()
  })

  it('builds the NIC table from the guest config', async () => {
    await renderTab()

    await waitFor(() => expect(screen.getByText('net0')).toBeInTheDocument())
    expect(screen.getByText('vmbr0')).toBeInTheDocument()
    expect(screen.getByText('AA:BB:CC:DD:EE:FF')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
  })

  it('omits the NIC card when the guest has no network device', async () => {
    seedConfig({})
    await renderTab()

    expect(screen.queryByText('net0')).not.toBeInTheDocument()
    expect(screen.queryByText('Network')).not.toBeInTheDocument()
  })

  it('marks a NIC without firewall as disabled', async () => {
    seedConfig({ net0: 'e1000=11:22:33:44:55:66,bridge=vmbr1,firewall=0' })
    await renderTab()

    await waitFor(() => expect(screen.getByText('vmbr1')).toBeInTheDocument())
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })

  it('surfaces a rules-fetch failure as a blocking alert instead of an empty table', async () => {
    api.getVMRules.mockRejectedValue(new Error('PVE unreachable'))

    renderWithProviders(<VmFirewallTab {...PROPS} />)

    await waitFor(() => expect(screen.getByText('PVE unreachable')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Add rule' })).not.toBeInTheDocument()
  })

  it('updates the log level options from the log dialog', async () => {
    await renderTab()

    fireEvent.click(screen.getByRole('button', { name: 'Firewall Logs' }))

    await waitFor(() => expect(screen.getByText('Log IN:')).toBeInTheDocument())

    const inSelect = within(screen.getByText('Log IN:').parentElement!).getByRole('combobox')

    fireEvent.mouseDown(inSelect)
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'debug' }))

    await waitFor(() => expect(api.updateVMOptions).toHaveBeenCalledWith(CONN_ID, NODE, 'qemu', VMID, { log_level_in: 'debug' }))
  })

  it('keeps the Refresh tooltip reachable while the log refresh button is disabled', async () => {
    // Never settles: `logsLoading` stays true for the whole test, so the
    // refresh IconButton renders disabled. MUI drops the tooltip when its
    // direct child is a disabled <button>; the <span> wrapper is what keeps
    // the hover listeners alive.
    api.getVMFirewallLog.mockReturnValue(new Promise(() => {}))

    await renderTab()

    fireEvent.click(screen.getByRole('button', { name: 'Firewall Logs' }))

    const dialog = await screen.findByRole('dialog')
    const refresh = dialog.querySelector('.ri-refresh-line')?.closest('button')

    if (!refresh) throw new Error('refresh button not rendered in the log dialog')

    expect(refresh).toBeDisabled()
    expect(refresh.parentElement?.tagName).toBe('SPAN')

    fireEvent.mouseOver(refresh.parentElement!)

    const tip = await screen.findByRole('tooltip')

    expect(tip).toHaveTextContent('Refresh')
  })
})
