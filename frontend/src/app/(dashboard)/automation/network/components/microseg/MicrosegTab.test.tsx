/**
 * Integration coverage for the micro-segmentation east-west container.
 *
 * The canvas itself is replaced by a small prop-driven stub so these tests can
 * focus on IP loading, flow counts, partial-scan messaging, selection handoff,
 * and the ingress rule payload created by the dialog. MSW owns the one fetch
 * route and unhandled requests remain test failures. RTL cleanup is explicit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from '@/__tests__/setup/renderWithProviders'
import { HttpResponse, http, server } from '@/__tests__/setup/msw-server'
import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

vi.mock('./EastWestCanvas', () => ({
  default: ({ nodes, edges, onVmClick, onFlowClick, onAddRuleClick }: any) => {
    const source = nodes.find((node: any) => node.id === 'src-100')
    const flowNodes = nodes.filter((node: any) => node.type === 'msFlow')

    return (
      <div data-testid='canvas'>
        <span>{nodes.length} nodes, {edges.length} edges</span>
        <button onClick={() => source && onVmClick('source', source.data.vmid)}>select source</button>
        <button onClick={onAddRuleClick}>add flow rule</button>
        {flowNodes.map((node: any, index: number) => (
          <button key={node.id} onClick={() => onFlowClick(node.data)}>edit flow {index}</button>
        ))}
      </div>
    )
  },
}))

vi.mock('@/lib/api/firewall', () => ({ addVMRule: vi.fn(), updateVMRule: vi.fn(), updateSecurityGroupRule: vi.fn() }))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import * as firewallAPI from '@/lib/api/firewall'

import MicrosegTab from './MicrosegTab'

const api = firewallAPI as unknown as Record<'addVMRule' | 'updateVMRule' | 'updateSecurityGroupRule', ReturnType<typeof vi.fn>>
const CONN = 'conn-1'

const WEB: VMFirewallInfo = {
  vmid: 100, name: 'web-01', node: 'pve1', type: 'qemu', status: 'running',
  firewallEnabled: true,
  rules: [{ pos: 0, type: 'out', action: 'ACCEPT', enable: 1, dest: '10.0.0.20', proto: 'tcp', dport: '443' }],
  options: { enable: 1, policy_in: 'DROP', policy_out: 'ACCEPT' },
  vlans: [],
}

const DB: VMFirewallInfo = {
  vmid: 101, name: 'db-01', node: 'pve2', type: 'lxc', status: 'running',
  firewallEnabled: true, rules: [], options: { enable: 1, policy_in: 'DROP', policy_out: 'ACCEPT' }, vlans: [],
  nics: [{ index: 0, bridge: 'vmbr0', firewall: true }],
}

const NO_IP: VMFirewallInfo = {
  vmid: 102, name: 'unknown-01', node: 'pve1', type: 'qemu', status: 'stopped',
  firewallEnabled: true, rules: [], options: null, vlans: [],
}

function props(overrides: Partial<React.ComponentProps<typeof MicrosegTab>> = {}) {
  return {
    vmFirewallData: [WEB, DB, NO_IP],
    loadingVMRules: false,
    guestsNotScanned: 0,
    reloadVMFirewallRules: vi.fn().mockResolvedValue(undefined),
    securityGroups: [],
    aliases: [],
    ipsets: [],
    selectedConnection: CONN,
    reload: vi.fn(),
    ...overrides,
  }
}

function installIps(onBody?: (body: any) => void) {
  server.use(http.post('/api/v1/vms/ips', async ({ request }) => {
    onBody?.(await request.json())

    return HttpResponse.json({ data: {
      [`${CONN}:qemu:pve1:100`]: { ip: '10.0.0.10' },
      [`${CONN}:lxc:pve2:101`]: { ip: '10.0.0.20' },
    } })
  }))
}

function renderTab(overrides: Parameters<typeof props>[0] = {}) {
  const p = props(overrides)
  renderWithProviders(<MicrosegTab {...p} />)
  return p
}

/** Pick an Autocomplete option by typing then clicking it in the listbox. */
function pickOption(input: HTMLElement, typed: string, optionText: RegExp) {
  fireEvent.change(input, { target: { value: typed } })
  fireEvent.click(within(screen.getByRole('listbox')).getByText(optionText))
}

/** Commit free text into a freeSolo Autocomplete (autoSelect commits on blur). */
function typeFreeText(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } })
  fireEvent.blur(input)
}

/** A MUI Select's combobox, found from its rendered label. */
function selectCombo(scope: ReturnType<typeof within>, label: string) {
  const el = scope.queryAllByText(label).find(node => node.tagName === 'LABEL')
  if (!el?.parentElement) throw new Error(`No Select labelled "${label}"`)
  return within(el.parentElement).getByRole('combobox')
}

describe('MicrosegTab', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    api.addVMRule.mockResolvedValue(undefined)
    api.updateVMRule.mockResolvedValue(undefined)
    api.updateSecurityGroupRule.mockResolvedValue(undefined)
    installIps()
  })

  it('posts the guest list for IP resolution and renders the resolved flow count', async () => {
    let body: any
    installIps(value => { body = value })
    renderTab()

    await waitFor(() => expect(body).toEqual({ vms: [
      { connId: CONN, type: 'qemu', node: 'pve1', vmid: '100', status: 'running' },
      { connId: CONN, type: 'lxc', node: 'pve2', vmid: '101', status: 'running' },
      { connId: CONN, type: 'qemu', node: 'pve1', vmid: '102', status: 'stopped' },
    ] }))
    await waitFor(() => expect(screen.getByText('1 flows')).toBeInTheDocument())

    // The resolved flow shows up as one overview edge before any selection.
    expect(screen.getByTestId('canvas')).toHaveTextContent('1 edges')
  })

  it('shows the partial-scan alert only when guests were omitted', () => {
    const { rerender } = renderWithProviders(<MicrosegTab {...props({ guestsNotScanned: 3, vmFirewallData: [] })} />)

    expect(screen.getByText('3 guests were not scanned, this count may be incomplete')).toBeInTheDocument()

    rerender(<MicrosegTab {...props({ guestsNotScanned: 0, vmFirewallData: [] })} />)
    expect(screen.queryByText(/guests were not scanned/)).not.toBeInTheDocument()
  })

  it('narrows the canvas to the VMs picked in the filter', async () => {
    renderTab()
    await waitFor(() => expect(screen.getByText('1 flows')).toBeInTheDocument())

    // 3 swim-lanes + 3 guests in both columns + the hint card.
    expect(screen.getByTestId('canvas')).toHaveTextContent('10 nodes')

    const picker = screen.getByLabelText('Filter VMs')

    fireEvent.change(picker, { target: { value: 'web' } })
    fireEvent.click(within(screen.getByRole('listbox')).getByText('web-01 (100)'))

    // Only the picked guest keeps its two cards.
    expect(screen.getByTestId('canvas')).toHaveTextContent('6 nodes')
  })

  it('prefills a selected source and creates an ingress rule on the destination', async () => {
    const p = renderTab()
    await waitFor(() => expect(screen.getByText('1 flows')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'select source' }))
    fireEvent.click(screen.getByRole('button', { name: 'add flow rule' }))

    const dialog = within(screen.getByRole('dialog'))

    expect(dialog.getByLabelText('Source')).toHaveValue('web-01 (100) · 10.0.0.10')

    pickOption(dialog.getByLabelText('Destination'), 'db', /db-01/)
    fireEvent.change(dialog.getByLabelText('Port'), { target: { value: '5432' } })

    // The interface list belongs to the rule's carrier: the destination guest.
    fireEvent.mouseDown(selectCombo(dialog, 'Interface'))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'net0 (vmbr0)' }))

    fireEvent.click(dialog.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.addVMRule).toHaveBeenCalledWith(CONN, 'pve2', 'lxc', 101, {
      type: 'in',
      action: 'ACCEPT',
      enable: 1,
      source: '10.0.0.10',
      proto: 'tcp',
      dport: '5432',
      iface: 'net0',
      comment: 'east-west: web-01 -> db-01',
    }))
    await waitFor(() => expect(p.reloadVMFirewallRules).toHaveBeenCalledWith(DB))
  })

  it('accepts a free CIDR as source of an ingress rule', async () => {
    renderTab()
    await waitFor(() => expect(screen.getByText('1 flows')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'add flow rule' }))

    const dialog = within(screen.getByRole('dialog'))

    typeFreeText(dialog.getByLabelText('Source'), '10.99.0.0/24')
    pickOption(dialog.getByLabelText('Destination'), 'db', /db-01/)
    fireEvent.click(dialog.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.addVMRule).toHaveBeenCalledWith(CONN, 'pve2', 'lxc', 101, {
      type: 'in',
      action: 'ACCEPT',
      enable: 1,
      source: '10.99.0.0/24',
      proto: 'tcp',
      comment: 'east-west: 10.99.0.0/24 -> db-01',
    }))
  })

  it('flips to an egress rule on the source when the destination is a free IP', async () => {
    const p = renderTab()
    await waitFor(() => expect(screen.getByText('1 flows')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'select source' }))
    fireEvent.click(screen.getByRole('button', { name: 'add flow rule' }))

    const dialog = within(screen.getByRole('dialog'))

    typeFreeText(dialog.getByLabelText('Destination'), '192.168.1.50')
    expect(dialog.getByText('An OUT ACCEPT rule will be created on web-01')).toBeInTheDocument()

    fireEvent.change(dialog.getByLabelText('Port'), { target: { value: '443' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.addVMRule).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', 100, {
      type: 'out',
      action: 'ACCEPT',
      enable: 1,
      dest: '192.168.1.50',
      proto: 'tcp',
      dport: '443',
      comment: 'east-west: web-01 -> 192.168.1.50',
    }))
    await waitFor(() => expect(p.reloadVMFirewallRules).toHaveBeenCalledWith(WEB))
  })

  it('keeps a picked guest when its field blurs, instead of degrading it to text', async () => {
    renderTab()
    await waitFor(() => expect(screen.getByText('1 flows')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'add flow rule' }))

    const dialog = within(screen.getByRole('dialog'))

    pickOption(dialog.getByLabelText('Destination'), 'db', /db-01/)
    // autoSelect re-commits the input text on blur; the picked guest must survive.
    fireEvent.blur(dialog.getByLabelText('Destination'))

    expect(dialog.queryByText('Not a valid IP or CIDR')).not.toBeInTheDocument()
    expect(dialog.getByText('An IN ACCEPT rule will be created on db-01')).toBeInTheDocument()
  })

  it('refuses two free endpoints and an invalid free address', async () => {
    renderTab()
    await waitFor(() => expect(screen.getByText('1 flows')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'add flow rule' }))

    const dialog = within(screen.getByRole('dialog'))

    typeFreeText(dialog.getByLabelText('Source'), '10.0.0.0/8')
    typeFreeText(dialog.getByLabelText('Destination'), '10.99.99.1')
    expect(dialog.getByText('At least one side must be a VM: the rule is stored on a VM firewall')).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()

    typeFreeText(dialog.getByLabelText('Source'), 'not-an-ip')
    expect(dialog.getByText('Not a valid IP or CIDR')).toBeInTheDocument()
  })

  it('opens the edit modal from a connection card and saves the VM rule in place', async () => {
    const p = renderTab()
    await waitFor(() => expect(screen.getByText('1 flows')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'select source' }))
    fireEvent.click(screen.getByRole('button', { name: 'edit flow 0' }))

    const dialog = within(screen.getByRole('dialog'))

    // Seeded from the real rule, saved back to the same position.
    expect(dialog.getByLabelText('Dest port')).toHaveValue('443')
    fireEvent.change(dialog.getByLabelText('Dest port'), { target: { value: '8443' } })
    fireEvent.click(dialog.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(api.updateVMRule).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', 100, 0, {
      type: 'out', action: 'ACCEPT', enable: 1, proto: 'tcp', dport: '8443', sport: '',
      source: '', dest: '10.0.0.20', macro: '', iface: '', log: 'nolog', comment: '',
    }))
    await waitFor(() => expect(p.reloadVMFirewallRules).toHaveBeenCalledWith(WEB))
  })

  it('edits a rule expanded from a security group through the SG API, with a warning', async () => {
    const SG = { group: 'sg-web', rules: [{ pos: 2, type: 'in', action: 'ACCEPT', enable: 1, source: '10.0.0.10', proto: 'tcp', dport: '22' }] }
    const CARRIER: VMFirewallInfo = {
      ...DB, rules: [{ pos: 0, type: 'group', action: 'sg-web', enable: 1 }],
    }
    const p = renderTab({ vmFirewallData: [{ ...WEB, rules: [] }, CARRIER], securityGroups: [SG] })

    await waitFor(() => expect(screen.getByText('1 flows')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'select source' }))
    fireEvent.click(screen.getByRole('button', { name: 'edit flow 0' }))

    const dialog = within(screen.getByRole('dialog'))

    expect(dialog.getByText('This rule belongs to security group sg-web. Changing it affects every guest using that group.')).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(api.updateSecurityGroupRule).toHaveBeenCalledWith(CONN, 'sg-web', 2, {
      type: 'in', action: 'ACCEPT', enable: 1, proto: 'tcp', dport: '22', sport: '',
      source: '10.0.0.10', dest: '', macro: '', iface: '', log: 'nolog', comment: '',
    }))
    await waitFor(() => expect(p.reload).toHaveBeenCalled())
    expect(api.updateVMRule).not.toHaveBeenCalled()
  })

  it('refuses a rule from a machine to itself, picked or typed as its own IP', async () => {
    renderTab()
    await waitFor(() => expect(screen.getByText('1 flows')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'select source' }))
    fireEvent.click(screen.getByRole('button', { name: 'add flow rule' }))

    const dialog = within(screen.getByRole('dialog'))

    // The source guest cannot even be picked as destination.
    fireEvent.change(dialog.getByLabelText('Destination'), { target: { value: 'web' } })
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: /web-01/ })).toHaveAttribute('aria-disabled', 'true')

    // Typing the source's own IP as free destination is caught too.
    typeFreeText(dialog.getByLabelText('Destination'), '10.0.0.10')
    expect(dialog.getByText('Source and destination are the same machine, there is nothing to allow')).toBeInTheDocument()
    expect(dialog.queryByText(/OUT ACCEPT rule/)).not.toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('blocks a source guest with no resolved IP behind an ingress rule', async () => {
    renderTab()
    await waitFor(() => expect(screen.getByText('1 flows')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'add flow rule' }))

    const dialog = within(screen.getByRole('dialog'))

    pickOption(dialog.getByLabelText('Source'), 'unknown', /unknown-01/)
    pickOption(dialog.getByLabelText('Destination'), 'db', /db-01/)

    expect(dialog.getByText(/No IP address is known for the source VM/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()
  })
})
