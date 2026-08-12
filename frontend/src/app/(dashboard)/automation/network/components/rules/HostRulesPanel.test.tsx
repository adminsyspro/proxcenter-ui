/**
 * Component tests for HostRulesPanel.tsx — the per-node (host) firewall
 * rules table.
 *
 * The panel is fully prop-driven: the rules, the node list and the loading
 * flag all come from the page above it, so a render here exercises the real
 * table without a live cluster. Only the two things it fetches itself are
 * stubbed — the firewall API module (per-node options on mount, and the
 * add/delete rule calls) and the raw `fetch` PUTs it does for updates and
 * reordering, which MSW serves. The jsdom setup errors on unhandled
 * requests, so a route the panel calls without a fixture fails the test.
 *
 * The assertions follow what an operator reading the Host Rules tab relies
 * on: a node is a collapsed section until clicked, its rules then show with
 * the right log level, a node without rules offers to create one, the two
 * switches (node firewall, per-rule Active) reach PVE, and the edit dialog
 * is pre-filled from the rule — including its log level, the field this PR
 * stopped dropping. Both the fully-populated and the bare rule are asserted
 * because the dialog pre-fill falls back field by field (`rule.proto || ''`,
 * `rule.log || 'nolog'`), and only a rule that carries nothing exercises
 * those fallbacks.
 *
 * The MUI Selects in the rule dialog carry an InputLabel but no `labelId`,
 * so their combobox has no accessible name and must be located from the
 * rendered label element — same limitation as LogLevelSelect.test.tsx.
 *
 * No automatic RTL cleanup is configured in this repo, hence afterEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import type * as firewallAPIType from '@/lib/api/firewall'

vi.mock('@/lib/api/firewall', () => ({
  getNodeOptions: vi.fn(),
  updateNodeOptions: vi.fn(),
  addNodeRule: vi.fn(),
  deleteNodeRule: vi.fn(),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import * as firewallAPI from '@/lib/api/firewall'

import HostRulesPanel from './HostRulesPanel'

const api = firewallAPI as unknown as Record<string, ReturnType<typeof vi.fn>>

const CONN = 'conn-1'
const NODE = 'pve1'
const OTHER_NODE = 'pve2'

/** A rule where every optional PVE field is set. */
const FULL_RULE: firewallAPIType.FirewallRule = {
  pos: 0, type: 'in', action: 'ACCEPT', enable: 1,
  proto: 'tcp', dport: '22', sport: '1024:65535',
  source: '10.0.0.0/8', dest: '10.0.0.5', macro: '',
  iface: 'vmbr0', log: 'warning', comment: 'ssh in',
}

/** A rule as PVE returns it when nothing optional was configured. */
const BARE_RULE: firewallAPIType.FirewallRule = { pos: 1, type: '', action: '' }

const ALIASES: firewallAPIType.Alias[] = [{ name: 'net-mgmt', cidr: '10.99.99.0/24' }]
const IPSETS: firewallAPIType.IPSet[] = [{ name: 'trusted', members: [{ cidr: '1.2.3.4' }] }]

function props(overrides: Partial<React.ComponentProps<typeof HostRulesPanel>> = {}) {
  return {
    hostRulesByNode: { [NODE]: [FULL_RULE, BARE_RULE], [OTHER_NODE]: [] },
    nodesList: [NODE, OTHER_NODE],
    securityGroups: [{ group: 'sg-web' }] as firewallAPIType.SecurityGroup[],
    loadingHostRules: false,
    selectedConnection: CONN,
    loadHostRules: vi.fn().mockResolvedValue(undefined),
    reloadHostRulesForNode: vi.fn().mockResolvedValue(undefined),
    aliases: ALIASES,
    ipsets: IPSETS,
    ...overrides,
  }
}

/** Render and wait for the per-node options fetch to settle. */
async function renderPanel(overrides: Parameters<typeof props>[0] = {}) {
  const p = props(overrides)

  renderWithProviders(<HostRulesPanel {...p} />)
  await waitFor(() => expect(api.getNodeOptions).toHaveBeenCalled())

  return p
}

/** The section header row of a node is clickable to expand it. */
const expandNode = (node: string) => fireEvent.click(screen.getByText(node))

/** A Select inside the open rule dialog, found from its rendered label. */
function selectByLabel(label: string) {
  const el = screen.queryAllByText(label).find(n => n.tagName === 'LABEL')

  if (!el?.parentElement) throw new Error(`No Select labelled "${label}"`)

  return within(el.parentElement).getByRole('combobox')
}

/** Open the edit dialog of the rule at `pos` and wait for the dialog title. */
async function openEditDialog(pos: number) {
  const rows = screen.getAllByRole('row')
  const row = rows.find(r => within(r).queryByText(String(pos)) && within(r).queryByRole('button', { name: 'Edit' }))

  if (!row) throw new Error(`No rule row at position ${pos}`)

  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
  await waitFor(() => expect(screen.getByText('Edit Host rule')).toBeInTheDocument())
}

describe('HostRulesPanel', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    api.getNodeOptions.mockResolvedValue({ enable: 1 })
    api.updateNodeOptions.mockResolvedValue(undefined)
    api.addNodeRule.mockResolvedValue(undefined)
    api.deleteNodeRule.mockResolvedValue(undefined)
    server.use(
      http.put(`*/api/v1/firewall/nodes/${CONN}/:node/rules/:pos`, () => HttpResponse.json({})),
    )
  })

  it('lists every node as a collapsed section with its rule count', async () => {
    await renderPanel()

    expect(screen.getByText(NODE)).toBeInTheDocument()
    expect(screen.getByText(OTHER_NODE)).toBeInTheDocument()
    expect(screen.getByText('2 rules')).toBeInTheDocument()
    expect(screen.getByText('0 rules')).toBeInTheDocument()

    // The toolbar counts hosts and rules across the whole tab.
    expect(screen.getByText('2/2 hosts • 2 rules')).toBeInTheDocument()

    // Collapsed: no rule is on screen yet.
    expect(screen.queryByText('ssh in')).not.toBeInTheDocument()
  })

  it('reveals a node\'s rules, with their log level, when the section is expanded', async () => {
    await renderPanel()

    expandNode(NODE)

    expect(screen.getByText('ssh in')).toBeInTheDocument()
    expect(screen.getByText('warning')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.0/8')).toBeInTheDocument()
    expect(screen.getByText('TCP/22')).toBeInTheDocument()

    // Clicking again collapses it.
    expandNode(NODE)
    expect(screen.queryByText('ssh in')).not.toBeInTheDocument()
  })

  it('offers to create a rule on a node that has none', async () => {
    await renderPanel()

    expandNode(OTHER_NODE)

    const emptyRow = screen.getAllByRole('row').find(r => within(r).queryByText('No rule configured'))!

    expect(emptyRow).toBeDefined()

    // The empty state's own Add button (every section header carries one too)
    // opens the dialog for that node.
    fireEvent.click(within(emptyRow).getByRole('button', { name: 'Add rule' }))
    await waitFor(() => expect(screen.getByText('Add Host rule')).toBeInTheDocument())
    expect(within(screen.getByRole('dialog')).getByText(OTHER_NODE)).toBeInTheDocument()
  })

  it('expands and collapses every node at once from the toolbar', async () => {
    await renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText('ssh in')).toBeInTheDocument()
    expect(screen.getByText('No rule configured')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('ssh in')).not.toBeInTheDocument()
  })

  it('filters the node list by the search box', async () => {
    await renderPanel()

    fireEvent.change(screen.getByPlaceholderText('Search host...'), { target: { value: OTHER_NODE } })

    expect(screen.queryByText(NODE)).not.toBeInTheDocument()
    expect(screen.getByText(OTHER_NODE)).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search host...'), { target: { value: 'nope' } })
    expect(screen.getByText('No results for this search')).toBeInTheDocument()
  })

  it('turns a node firewall off through the section switch', async () => {
    await renderPanel()

    // One switch per node section header; the first belongs to pve1. Wait for
    // the fetched options to reach it: clicking while they are still in flight
    // would read the node as off and ask PVE to enable it instead.
    const nodeSwitch = () => screen.getAllByRole('switch')[0]

    await waitFor(() => expect(nodeSwitch()).toBeChecked())

    fireEvent.click(nodeSwitch())

    await waitFor(() => expect(api.updateNodeOptions).toHaveBeenCalledWith(CONN, NODE, { enable: 0 }))
  })

  it('toggles a rule\'s Active switch against the node rules endpoint', async () => {
    await renderPanel()
    expandNode(NODE)

    const row = screen.getAllByRole('row').find(r => within(r).queryByText('ssh in'))!
    const requests: Request[] = []

    server.use(
      http.put(`*/api/v1/firewall/nodes/${CONN}/${NODE}/rules/0`, ({ request }) => {
        requests.push(request.clone())

        return HttpResponse.json({})
      }),
    )

    fireEvent.click(within(row).getByRole('switch'))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(await requests[0].json()).toMatchObject({ pos: 0, enable: 0, log: 'warning' })
  })

  it('pre-fills the edit dialog from the rule, log level included', async () => {
    await renderPanel()
    expandNode(NODE)
    await openEditDialog(0)

    const dialog = within(screen.getByRole('dialog'))

    expect(dialog.getByLabelText('Source')).toHaveValue('10.0.0.0/8')
    expect(dialog.getByLabelText('Destination')).toHaveValue('10.0.0.5')
    expect(dialog.getByLabelText('Destination port')).toHaveValue('22')
    expect(dialog.getByLabelText('Source port')).toHaveValue('1024:65535')
    expect(dialog.getByLabelText('Interface')).toHaveValue('vmbr0')
    expect(dialog.getByLabelText('Comment')).toHaveValue('ssh in')
    expect(selectByLabel('Log level')).toHaveTextContent('warning')
    expect(selectByLabel('Type')).toHaveTextContent('IN (inbound)')
  })

  it('falls back to PVE defaults when editing a rule that carries nothing', async () => {
    await renderPanel()
    expandNode(NODE)
    await openEditDialog(1)

    const dialog = within(screen.getByRole('dialog'))

    // `rule.type || 'in'`, `rule.action || 'ACCEPT'`, `rule.log || 'nolog'`:
    // an empty PVE field must not reach the form as an empty value.
    expect(selectByLabel('Type')).toHaveTextContent('IN (inbound)')
    expect(selectByLabel('Action')).toHaveTextContent('ACCEPT')
    expect(selectByLabel('Log level')).toHaveTextContent('nolog')
    expect(dialog.getByLabelText('Source')).toHaveValue('')
    expect(dialog.getByLabelText('Comment')).toHaveValue('')
  })

  it('opens an empty add-rule dialog and sends the picked log level', async () => {
    await renderPanel()
    expandNode(NODE)

    // The section header's own Add button (the first one on the pve1 row).
    const section = screen.getAllByRole('row').find(r => within(r).queryByText(NODE))!

    fireEvent.click(within(section).getByRole('button', { name: 'Add rule' }))
    await waitFor(() => expect(screen.getByText('Add Host rule')).toBeInTheDocument())

    expect(selectByLabel('Log level')).toHaveTextContent('nolog')

    fireEvent.mouseDown(selectByLabel('Log level'))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'crit' }))
    expect(selectByLabel('Log level')).toHaveTextContent('crit')

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(api.addNodeRule).toHaveBeenCalledTimes(1))
    expect(api.addNodeRule.mock.calls[0][2]).toMatchObject({ log: 'crit', type: 'in', action: 'ACCEPT' })
  })

  it('edits source and destination through the alias suggestions', async () => {
    await renderPanel()
    expandNode(NODE)
    await openEditDialog(1)

    const dialog = within(screen.getByRole('dialog'))
    const source = dialog.getByLabelText('Source')

    fireEvent.change(source, { target: { value: 'net' } })
    fireEvent.click(await screen.findByRole('option', { name: /net-mgmt/ }))
    expect(source).toHaveValue('net-mgmt')

    const dest = dialog.getByLabelText('Destination')

    fireEvent.change(dest, { target: { value: '192.168.1.0/24' } })
    expect(dest).toHaveValue('192.168.1.0/24')
  })

  it('saves an edited rule against its position', async () => {
    await renderPanel()
    expandNode(NODE)
    await openEditDialog(0)

    const requests: Request[] = []

    server.use(
      http.put(`*/api/v1/firewall/nodes/${CONN}/${NODE}/rules/0`, ({ request }) => {
        requests.push(request.clone())

        return HttpResponse.json({})
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(await requests[0].json()).toMatchObject({ log: 'warning', comment: 'ssh in' })
  })

  it('confirms before deleting a rule, then deletes it', async () => {
    const p = await renderPanel()

    expandNode(NODE)

    const row = screen.getAllByRole('row').find(r => within(r).queryByText('ssh in'))!

    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByText('Delete this rule?')).toBeInTheDocument())
    expect(screen.getByText(/Rule #0 on pve1 will be permanently deleted/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteNodeRule).toHaveBeenCalledWith(CONN, NODE, 0))
    expect(p.reloadHostRulesForNode).toHaveBeenCalledWith(NODE)
  })

  it('shows a progress bar instead of the table while the rules load', async () => {
    renderWithProviders(<HostRulesPanel {...props({ loadingHostRules: true })} />)

    expect(screen.getByText('Loading host rules...')).toBeInTheDocument()
    expect(screen.queryByText(NODE)).not.toBeInTheDocument()
  })

  it('swaps in the dark Proxmox logo when the theme is dark', async () => {
    const dark = createTheme({ palette: { mode: 'dark' } })

    renderWithProviders(
      <ThemeProvider theme={dark}><HostRulesPanel {...props()} /></ThemeProvider>,
    )
    await waitFor(() => expect(api.getNodeOptions).toHaveBeenCalled())

    const logos = document.querySelectorAll('img')

    expect(logos).toHaveLength(2)
    expect(logos[0]).toHaveAttribute('src', '/images/proxmox-logo-dark.svg')
  })

  it('renders nothing fetchable when no connection is selected', async () => {
    renderWithProviders(<HostRulesPanel {...props({ selectedConnection: '', nodesList: [], hostRulesByNode: {} })} />)

    expect(screen.getByText('Cannot retrieve node list.')).toBeInTheDocument()
    expect(api.getNodeOptions).not.toHaveBeenCalled()
  })
})
