/**
 * Component tests for FirewallPolicyTable.tsx — the cluster firewall header
 * (master switch + the two default policies) and the cluster rules table.
 *
 * Unlike the host and VM panels this table is flat: every cluster rule is
 * always on screen, so a render alone exercises the rows. What it does not
 * do itself is own the rules — the page above holds them and passes the
 * setters down — so the reload after a write is asserted through
 * `getClusterRules`, which is the panel's own refresh path.
 *
 * The rule writes go two ways on purpose: creation and deletion through the
 * firewall API module, updates and reordering through a raw `fetch` PUT that
 * MSW serves here. The jsdom setup errors on unhandled requests, so a route
 * called without a fixture fails the test.
 *
 * The rule form is the shared RuleFormDialog, covered on its own; what is
 * checked here is that the panel pre-fills it from the right rule — log
 * level included, the field this PR stopped dropping.
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

vi.mock('@/lib/api/firewall', () => ({
  updateClusterOptions: vi.fn(),
  getClusterRules: vi.fn(),
  addClusterRule: vi.fn(),
  deleteClusterRule: vi.fn(),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import * as firewallAPI from '@/lib/api/firewall'

import FirewallPolicyTable from './FirewallPolicyTable'

const api = firewallAPI as unknown as Record<string, ReturnType<typeof vi.fn>>

const CONN = 'conn-1'

const FULL_RULE: firewallAPIType.FirewallRule = {
  pos: 0, type: 'in', action: 'ACCEPT', enable: 1,
  proto: 'tcp', dport: '8006', sport: '', source: '10.0.0.0/8', dest: '',
  macro: '', iface: 'vmbr0', log: 'warning', comment: 'pve ui',
}

/** A cluster rule may reference a security group; a host or SG rule may not. */
const GROUP_RULE: firewallAPIType.FirewallRule = { pos: 1, type: 'group', action: 'sg-web', enable: 1 }

function props(overrides: Partial<React.ComponentProps<typeof FirewallPolicyTable>> = {}) {
  return {
    clusterRules: [FULL_RULE, GROUP_RULE],
    securityGroups: [{ group: 'sg-web' }] as firewallAPIType.SecurityGroup[],
    selectedConnection: CONN,
    setClusterRules: vi.fn(),
    clusterOptions: { enable: 1, policy_in: 'DROP', policy_out: 'ACCEPT' } as firewallAPIType.ClusterOptions,
    setClusterOptions: vi.fn(),
    aliases: [{ name: 'net-mgmt', cidr: '10.99.99.0/24' }] as firewallAPIType.Alias[],
    ipsets: [] as firewallAPIType.IPSet[],
    reload: vi.fn(),
    ...overrides,
  }
}

function renderTable(overrides: Parameters<typeof props>[0] = {}) {
  const p = props(overrides)

  renderWithProviders(<FirewallPolicyTable {...p} />)

  return p
}

const ruleRow = (text: string) => screen.getAllByRole('row').find(r => within(r).queryByText(text))!

/**
 * The cluster master switch. Every rule row carries an Active switch too, and
 * the header renders before the table, so the first switch is the master one.
 */
const masterSwitch = () => screen.getAllByRole('switch')[0]

/**
 * The header's Add rule button. The footer carries a second one with the same
 * accessible name; both open the same dialog, so the first is enough.
 */
const addRuleButton = () => screen.getAllByRole('button', { name: 'Add rule' })[0]

/** A Select inside the open rule dialog, found from its rendered label. */
function selectByLabel(label: string) {
  const el = screen.queryAllByText(label).find(n => n.tagName === 'LABEL')

  if (!el?.parentElement) throw new Error(`No Select labelled "${label}"`)

  return within(el.parentElement).getByRole('combobox')
}

describe('FirewallPolicyTable', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    api.updateClusterOptions.mockResolvedValue(undefined)
    api.getClusterRules.mockResolvedValue([FULL_RULE])
    api.addClusterRule.mockResolvedValue(undefined)
    api.deleteClusterRule.mockResolvedValue(undefined)
  })

  it('shows the cluster firewall as on, with its two default policies', () => {
    renderTable()

    expect(masterSwitch()).toBeChecked()
    expect(screen.getByText('ON')).toBeInTheDocument()

    const [policyIn, policyOut] = screen.getAllByRole('combobox')

    expect(policyIn).toHaveTextContent('DROP')
    expect(policyOut).toHaveTextContent('ACCEPT')
  })

  it('reads a cluster with no options at all as off, on PVE defaults', () => {
    renderTable({ clusterOptions: null })

    expect(masterSwitch()).not.toBeChecked()
    expect(screen.getByText('OFF')).toBeInTheDocument()

    const [policyIn, policyOut] = screen.getAllByRole('combobox')

    expect(policyIn).toHaveTextContent('DROP')
    expect(policyOut).toHaveTextContent('ACCEPT')
  })

  it('lists every cluster rule with its log level, group rules included', () => {
    renderTable()

    expect(screen.getByText('pve ui')).toBeInTheDocument()
    expect(screen.getByText('warning')).toBeInTheDocument()
    expect(screen.getByText('TCP/8006')).toBeInTheDocument()

    // The group rule names the group it references and shows no traffic.
    expect(screen.getByText('sg-web')).toBeInTheDocument()
    expect(screen.getByText('GROUP')).toBeInTheDocument()
  })

  it('turns the cluster firewall off through the master switch', async () => {
    const p = renderTable()

    fireEvent.click(masterSwitch())

    await waitFor(() => expect(api.updateClusterOptions).toHaveBeenCalledWith(CONN, { enable: 0 }))
    expect(p.setClusterOptions).toHaveBeenCalled()
    expect(p.reload).toHaveBeenCalled()
  })

  it('changes the inbound default policy', async () => {
    const p = renderTable()

    fireEvent.mouseDown(screen.getAllByRole('combobox')[0])
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'REJECT' }))

    await waitFor(() => expect(api.updateClusterOptions).toHaveBeenCalledWith(CONN, { policy_in: 'REJECT' }))
    expect(p.setClusterOptions).toHaveBeenCalled()
  })

  it('changes the outbound default policy', async () => {
    renderTable()

    fireEvent.mouseDown(screen.getAllByRole('combobox')[1])
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'DROP' }))

    await waitFor(() => expect(api.updateClusterOptions).toHaveBeenCalledWith(CONN, { policy_out: 'DROP' }))
  })

  it('toggles a rule Active switch against the cluster rules endpoint', async () => {
    renderTable()

    const requests: Request[] = []

    server.use(
      http.put(`*/api/v1/firewall/cluster/${CONN}/rules/0`, ({ request }) => {
        requests.push(request.clone())

        return HttpResponse.json({})
      }),
    )

    fireEvent.click(within(ruleRow('pve ui')).getByRole('switch'))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(await requests[0].json()).toMatchObject({ pos: 0, enable: 0, log: 'warning' })

    // The panel refreshes its own rules after the write.
    await waitFor(() => expect(api.getClusterRules).toHaveBeenCalledWith(CONN))
  })

  it('pre-fills the edit dialog from the rule, log level included', async () => {
    renderTable()

    fireEvent.click(within(ruleRow('pve ui')).getByRole('button', { name: 'Edit' }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    const dialog = within(screen.getByRole('dialog'))

    expect(dialog.getByLabelText('Source')).toHaveValue('10.0.0.0/8')
    expect(dialog.getByLabelText('Dest port')).toHaveValue('8006')
    expect(dialog.getByLabelText('Interface')).toHaveValue('vmbr0')
    expect(dialog.getByLabelText('Comment')).toHaveValue('pve ui')
    expect(selectByLabel('Log level')).toHaveTextContent('warning')
    expect(screen.getByText('Cluster')).toBeInTheDocument()
  })

  it('saves an edited rule against its position', async () => {
    renderTable()

    fireEvent.click(within(ruleRow('pve ui')).getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    const requests: Request[] = []

    server.use(
      http.put(`*/api/v1/firewall/cluster/${CONN}/rules/0`, ({ request }) => {
        requests.push(request.clone())

        return HttpResponse.json({})
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(await requests[0].json()).toMatchObject({ log: 'warning', comment: 'pve ui' })
  })

  it('adds a cluster rule with the picked log level', async () => {
    renderTable()

    fireEvent.click(addRuleButton())
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())

    expect(selectByLabel('Log level')).toHaveTextContent('nolog')

    fireEvent.mouseDown(selectByLabel('Log level'))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'err' }))

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(api.addClusterRule).toHaveBeenCalledTimes(1))
    expect(api.addClusterRule).toHaveBeenCalledWith(CONN, expect.objectContaining({ log: 'err', type: 'in' }))
  })

  it('confirms before deleting a rule, then deletes it', async () => {
    renderTable()

    fireEvent.click(within(ruleRow('pve ui')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByText('Delete this rule?')).toBeInTheDocument())

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteClusterRule).toHaveBeenCalledWith(CONN, 0))
  })

  it('reorders a rule by dropping it on another row', async () => {
    renderTable()

    const requests: Request[] = []

    server.use(
      http.put(`*/api/v1/firewall/cluster/${CONN}/rules/0`, ({ request }) => {
        requests.push(request.clone())

        return HttpResponse.json({})
      }),
    )

    const from = ruleRow('pve ui')
    const to = ruleRow('sg-web')
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: () => '0' }

    fireEvent.dragStart(from, { dataTransfer })

    fireEvent.dragOver(to, { dataTransfer })
    fireEvent.drop(to, { dataTransfer })

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(await requests[0].json()).toEqual({ moveto: 1 })
  })

  it('says so when the cluster has no rule, and still offers to add one', () => {
    renderTable({ clusterRules: [] })

    expect(screen.getByText('No rules')).toBeInTheDocument()
    expect(addRuleButton()).toBeEnabled()
  })

  it('disables every write when no connection is selected', () => {
    renderTable({ selectedConnection: '' })

    expect(masterSwitch()).toBeDisabled()
    for (const button of screen.getAllByRole('button', { name: 'Add rule' })) expect(button).toBeDisabled()
  })
})
