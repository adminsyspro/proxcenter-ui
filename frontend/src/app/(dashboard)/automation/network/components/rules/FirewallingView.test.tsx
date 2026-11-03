/**
 * The Firewalling tab (UA51) from a fixture: one table, the sections (the zone group of the engine, read-only, the
 * cluster, the hosts, the guests by VLAN), their badges, the inline edits that go to the draft (action, switches),
 * the bulk bar, the hits of a zone on its default deny row, the rules of a host or guest read when its section opens (one call),
 * the publish in one call, and every control disabled for a read-only user.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type * as firewallAPIType from '@/lib/api/firewall'
import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

const h = vi.hoisted(() => ({
  getNodeRules: vi.fn(),
  getNodeOptions: vi.fn(),
  toast: vi.fn(),
  events: [] as any[],
}))

vi.mock('@/lib/api/firewall', () => ({ getNodeRules: (...a: any[]) => h.getNodeRules(...a), getNodeOptions: (...a: any[]) => h.getNodeOptions(...a) }))
vi.mock('@/lib/microseg/useMicroseg', () => ({ useMicrosegPolicy: () => ({ data: { last_revision: { id: 'rev1' } } }) }))
vi.mock('@/lib/microseg/useLastRevision', () => ({
  useLastRevisionSnapshot: () => ({
    revision: { id: 'rev1', snapshot: { tag_prefix: 'pc-', flows: [], zones: [{ name: 'db', state: 'enforce' }] } },
    loading: false,
  }),
}))
vi.mock('@/lib/microseg/useMicrosegEvents', () => ({ useMicrosegEvents: () => ({ events: h.events, truncated: false }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: h.toast }) }))
vi.mock('@/components/firewall/FirewallLogDialog', () => ({ default: () => null }))

import { EMPTY_DRAFT, addRule, serializeDraft, toFields } from '@/lib/firewall/draft'

import { MicrosegWriteContext } from '../microseg/microsegAccess'
import FirewallingView, { type FirewallingViewProps } from './FirewallingView'

afterEach(cleanup)

const D = 'D1'
const CLUSTER_RULES: firewallAPIType.FirewallRule[] = [
  { pos: 0, type: 'in', action: 'ACCEPT', enable: 1, proto: 'tcp', dport: '22', source: '+management', comment: 'Admin SSH', digest: D },
  { pos: 1, type: 'in', action: 'ACCEPT', source: '10.42.0.12', proto: 'tcp', dport: '10050', comment: 'Old Zabbix', digest: D },
]
const ZONE_GROUP: firewallAPIType.SecurityGroup = {
  group: 'pcz-db',
  rules: [
    { pos: 0, type: 'in', action: 'ACCEPT', enable: 1, source: '+pcz-app', proto: 'tcp', dport: '5432', comment: '[pc-microseg] app -> db' },
    { pos: 1, type: 'in', action: 'ACCEPT', enable: 1, comment: '[pc-microseg] db -> db' },
  ],
}
const guest = (vmid: number, extra: Partial<VMFirewallInfo> = {}): VMFirewallInfo => ({
  vmid, name: `vm-${vmid}`, node: 'pve1', type: 'qemu', status: 'running', firewallEnabled: true, optionsEnabled: true,
  nicFirewallEnabled: true, stateUnknown: false, rules: [], rulesLoaded: false, options: null, vlans: [100], tags: [], ...extra,
})
const GUESTS = [guest(101, { firewallEnabled: false, optionsEnabled: false }), guest(102, { tags: ['pc-db'] })]

function props(over: Partial<FirewallingViewProps> = {}): FirewallingViewProps {
  return {
    connectionId: 'c1', connectionName: 'PVE-DR', firewallMode: 'cluster', nodesList: ['pve1', 'pve2'],
    clusterRules: CLUSTER_RULES, setClusterRules: vi.fn(), clusterOptions: { enable: 1 }, setClusterOptions: vi.fn(),
    hostRulesByNode: {}, setHostRulesByNode: vi.fn(), guests: GUESTS, setVMFirewallData: vi.fn(), loadingVMRules: false,
    loadGuestRules: vi.fn().mockResolvedValue([]), securityGroups: [ZONE_GROUP, { group: 'sg-web', rules: [] }], aliases: [], ipsets: [],
    initialScope: 'all', reloadFirewall: vi.fn(), reloadGuests: vi.fn().mockResolvedValue(undefined), onOpenMicroseg: vi.fn(),
    ...over,
  }
}

const renderView = (p = props(), canWrite = true) =>
  renderWithProviders(<MicrosegWriteContext.Provider value={canWrite}><FirewallingView {...p} /></MicrosegWriteContext.Provider>)

const ruleRow = (name: string) => screen.getAllByTestId('dfw-rule-row').find(r => within(r).queryByText(name))!
const publishButton = () => screen.getByRole('button', { name: /^Publish \(\d+\)$/ })

beforeEach(() => {
  vi.clearAllMocks()
  try { sessionStorage.clear() } catch { /* storage blocked */ }
  const now = Date.now()
  h.events = [
    ...Array.from({ length: 3 }, (_, i) => ({ seq: i, ts: new Date(now - 3600_000).toISOString(), zone: 'db', proto: 'tcp', dport: 5432, verdict: 'blocked' })),
    { seq: 9, ts: new Date(now - 3 * 86400_000).toISOString(), zone: 'db', proto: 'tcp', dport: 5432, verdict: 'blocked' },
  ]
})

describe('Firewalling: sections and badges', () => {
  it('shows the zone group of the engine read-only, the cluster, the hosts and the guests by VLAN', () => {
    renderView()
    const zone = screen.getByTestId('dfw-section-zone:pcz-db')
    expect(within(zone).getByText('Micro-segmentation · zone db')).toBeInTheDocument()
    expect(within(zone).getByText('Enforce')).toBeInTheDocument()
    expect(within(zone).getByText('managed by the engine')).toBeInTheDocument()
    expect(within(zone).getByRole('button', { name: /edit in Micro-segmentation/ })).toBeInTheDocument()
    expect(screen.getByTestId('dfw-section-cluster')).toHaveTextContent('Cluster rules')
    expect(screen.getByTestId('dfw-section-host:pve1')).toHaveTextContent('Rules on open')
    expect(screen.getByTestId('dfw-group-100')).toHaveTextContent('VLAN 100 · 2 VMs')
    expect(screen.getByTestId('dfw-group-100')).toHaveTextContent('1 protected by the micro-segmentation')
    // The sg-web group is no section: only the zone groups of the engine are.
    expect(screen.queryByTestId('dfw-section-zone:sg-web')).toBeNull()
  })

  it('reads the rows of a managed section as locked, the zone hits on its default deny row, numbered across the table', async () => {
    renderView()
    fireEvent.click(within(screen.getByTestId('dfw-section-zone:pcz-db')).getByRole('button', { name: /Expand/ }))
    const appRule = ruleRow('[pc-microseg] app -> db')
    expect(within(appRule).getAllByRole('checkbox')[0]).toBeDisabled()
    expect(within(appRule).queryByRole('combobox')).toBeNull()
    expect(within(appRule).getByTestId('dfw-hits')).toHaveTextContent('-')
    expect(within(ruleRow('[pc-microseg] db -> db')).getByTestId('dfw-hits')).toHaveTextContent('-')
    const deny = screen.getByTestId('dfw-default-deny')
    expect(deny).toHaveTextContent('Zone default deny')
    expect(deny).toHaveTextContent('Block')
    expect(within(deny).getByTestId('dfw-hits')).toHaveTextContent('3')
    expect(within(deny).queryByRole('checkbox')).toBeNull()
    // Zone rules 1 and 2, then the cluster's from 3.
    expect(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 3 enabled' })).toBeInTheDocument()
    expect(within(ruleRow('Admin SSH')).getByTestId('dfw-hits')).toHaveTextContent('-')
    fireEvent.mouseOver(within(ruleRow('Admin SSH')).getByTestId('dfw-hits'))
    expect(await screen.findByText('Proxmox exposes no per-rule counters')).toBeInTheDocument()
  })

  it('shows the service by its name, the raw protocol and port in the tooltip, and a disabled rule dimmed', async () => {
    renderView()
    const ssh = ruleRow('Admin SSH')
    expect(within(ssh).getByText('SSH')).toBeInTheDocument()
    fireEvent.mouseOver(within(ssh).getByText('SSH'))
    expect(await screen.findByText('SSH (tcp/22)')).toBeInTheDocument()
    const zabbix = ruleRow('Old Zabbix')
    expect(within(zabbix).getByText('disabled')).toBeInTheDocument()
    expect(zabbix).toHaveStyle({ opacity: '0.6' })
  })

  it('states the totals in the status bar', () => {
    renderView()
    const status = screen.getByTestId('dfw-status')
    expect(status).toHaveTextContent('Rules: at least 4 in total')
    expect(status).toHaveTextContent('Unpublished 0')
    expect(status).toHaveTextContent('Disabled 1')
    expect(status).toHaveTextContent('Sections: 6')
    expect(status).toHaveTextContent('Managed by the micro-segmentation 1')
    expect(status).toHaveTextContent('VMs covered: 1 / 2 running')
  })
})

describe('Firewalling: edits go to the draft', () => {
  it('an inline action change is one unpublished change', async () => {
    renderView()
    expect(publishButton()).toHaveTextContent('Publish (0)')
    fireEvent.mouseDown(within(ruleRow('Admin SSH')).getByRole('combobox', { name: 'Rule action' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Drop' }))
    expect(publishButton()).toHaveTextContent('Publish (1)')
    expect(ruleRow('Admin SSH')).toHaveAttribute('data-state', 'edited')
    expect(within(screen.getByTestId('dfw-section-cluster')).getByText('1 unpublished')).toBeInTheDocument()
  })

  it('a switch toggled twice is no change', () => {
    renderView()
    const enabled = () => within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' })
    fireEvent.click(enabled())
    expect(publishButton()).toHaveTextContent('Publish (1)')
    fireEvent.click(enabled())
    expect(publishButton()).toHaveTextContent('Publish (0)')
    expect(publishButton()).toBeDisabled()
  })

  it('the bulk bar acts on the checked rules', () => {
    renderView()
    const bar = screen.getByTestId('dfw-actions')
    expect(within(bar).getByRole('button', { name: 'Delete' })).toBeDisabled()
    fireEvent.click(within(ruleRow('Old Zabbix')).getByRole('checkbox', { name: 'Select rule 2' }))
    expect(within(bar).getByText(/1 rule selected/)).toBeInTheDocument()
    for (const name of ['Enable', 'Disable', 'Clone', 'Move up', 'Move down', 'Move to section', 'Delete']) {
      expect(within(bar).getByRole('button', { name })).toBeEnabled()
    }
    fireEvent.click(within(bar).getByRole('button', { name: 'Enable' }))
    expect(publishButton()).toHaveTextContent('Publish (1)')
    fireEvent.click(within(bar).getByRole('button', { name: 'Delete' }))
    expect(screen.queryAllByTestId('dfw-rule-row').some(r => within(r).queryByText('Old Zabbix'))).toBe(false)
    expect(publishButton()).toHaveTextContent('Publish (1)')
  })

  it('turns a guest firewall on at publish from its badge, and back', () => {
    renderView()
    fireEvent.click(within(screen.getByTestId('dfw-group-100')).getByRole('button', { name: /Expand/ }))
    const section = screen.getByTestId('dfw-section-guest:qemu/101')
    expect(within(section).getByText('guest firewall OFF')).toBeInTheDocument()
    fireEvent.click(within(section).getByRole('button', { name: 'enable firewall' }))
    expect(within(screen.getByTestId('dfw-section-guest:qemu/101')).getByText('firewall on at publish')).toBeInTheDocument()
    expect(publishButton()).toHaveTextContent('Publish (1)')
    fireEvent.click(within(screen.getByTestId('dfw-section-guest:qemu/101')).getByRole('button', { name: 'undo' }))
    expect(publishButton()).toHaveTextContent('Publish (0)')
  })
})

describe('Firewalling: rules read on demand', () => {
  it('reads a guest rules only when its section opens, one call', async () => {
    const p = props()
    renderView(p)
    fireEvent.click(within(screen.getByTestId('dfw-group-100')).getByRole('button', { name: /Expand/ }))
    expect(p.loadGuestRules).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByTestId('dfw-section-guest:qemu/102')).getByRole('button', { name: /Expand/ }))
    await waitFor(() => expect(p.loadGuestRules).toHaveBeenCalledTimes(1))
    expect(p.loadGuestRules).toHaveBeenCalledWith(GUESTS[1])
  })

  it('reads a host rules then its options when its section opens, nothing for the other host', async () => {
    h.getNodeRules.mockResolvedValue([{ pos: 0, type: 'in', action: 'ACCEPT', comment: 'host ssh', digest: 'H' }])
    h.getNodeOptions.mockResolvedValue({ enable: 0 })
    const p = props()
    renderView(p)
    fireEvent.click(within(screen.getByTestId('dfw-section-host:pve1')).getByRole('button', { name: /Expand/ }))
    await waitFor(() => expect(h.getNodeOptions).toHaveBeenCalledWith('c1', 'pve1'))
    expect(h.getNodeRules).toHaveBeenCalledTimes(1)
    expect(h.getNodeRules).toHaveBeenCalledWith('c1', 'pve1')
    expect(p.setHostRulesByNode).toHaveBeenCalled()
  })
})

describe('Firewalling: publish', () => {
  it('sends the draft in one call and puts the lists the server re-read in place', async () => {
    const fresh = [{ ...CLUSTER_RULES[0], action: 'DROP', digest: 'D2' }, CLUSTER_RULES[1]]
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ applied: 1, total: 1, scopes: { cluster: { digest: 'D2', rules: fresh } } }), { status: 200 }))
    const p = props()
    renderView(p)
    fireEvent.mouseDown(within(ruleRow('Admin SSH')).getByRole('combobox', { name: 'Rule action' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Drop' }))
    fireEvent.click(publishButton())
    await waitFor(() => expect(p.setClusterRules).toHaveBeenCalledWith(fresh))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/v1/firewall/publish/c1')
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.ops).toEqual([expect.objectContaining({ kind: 'rule.edit', pos: 0, patch: { type: 'in', action: 'DROP' } })])
    expect(body.digests).toEqual({ cluster: 'D1' })
    expect(h.toast).toHaveBeenCalledWith('1 change published', 'success')
    fetchSpy.mockRestore()
  })

  it('keeps the changes not applied and says why the publish stopped', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      applied: 0, total: 1, scopes: {}, failed: { index: 0, kind: 'rule.edit', scope: 'cluster', code: 'DIGEST_CONFLICT', message: 'changed' },
    }), { status: 409 }))
    renderView()
    fireEvent.click(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' }))
    fireEvent.click(publishButton())
    expect(await screen.findByTestId('dfw-publish-error')).toHaveTextContent('Publish stopped after 0 changes applied: the rules of a section were changed in Proxmox')
    expect(publishButton()).toHaveTextContent('Publish (1)')
    fetchSpy.mockRestore()
  })
})

describe('Firewalling: a large publish', () => {
  it('asks a confirmation stating the count above 50 changes, then sends them confirmed', async () => {
    let d = EMPTY_DRAFT
    for (let i = 0; i < 51; i++) d = addRule(d, { kind: 'cluster' }, CLUSTER_RULES, toFields({ comment: `bulk ${i}` }))
    sessionStorage.setItem('firewall.draft.c1', serializeDraft(d))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ applied: 51, total: 51, scopes: {} }), { status: 200 }))
    renderView()
    fireEvent.click(publishButton())
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Publish 51 changes')
    expect(fetchSpy).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body))
    expect(body.ops).toHaveLength(51)
    expect(body.confirmed).toBe(true)
    fetchSpy.mockRestore()
  })

  it('sends 100 changes at most per call and keeps the rest for the next publish', async () => {
    let d = EMPTY_DRAFT
    for (let i = 0; i < 104; i++) d = addRule(d, { kind: 'cluster' }, CLUSTER_RULES, toFields({ comment: `bulk ${i}` }))
    sessionStorage.setItem('firewall.draft.c1', serializeDraft(d))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ applied: 100, total: 100, scopes: { cluster: { digest: 'D9' } } }), { status: 200 }))
    renderView()
    fireEvent.click(publishButton())
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publish' }))
    expect(await screen.findByText('100 of 104 changes published: publish again for the rest')).toBeInTheDocument()
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)).ops).toHaveLength(100)
    await waitFor(() => expect(publishButton()).toHaveTextContent('Publish (4)'))
    fetchSpy.mockRestore()
  })
})

describe('Firewalling: the engine block of a guest and the way out of a conflict', () => {
  const ZONED = guest(103, {
    name: 'zoned', rulesLoaded: true, vlans: [],
    rules: [
      { pos: 0, type: 'group', action: 'pcz-db', enable: 1, comment: '[pc-microseg]', digest: 'G' },
      { pos: 1, type: 'in', action: 'ACCEPT', enable: 1, comment: 'u1', digest: 'G' },
      { pos: 2, type: 'in', action: 'ACCEPT', enable: 1, comment: 'u2', digest: 'G' },
      { pos: 3, type: 'in', action: 'ACCEPT', enable: 1, log: 'info', comment: '[pc-microseg] observe', digest: 'G' },
    ],
  })
  const openZoned = () => {
    renderView(props({ guests: [ZONED] }))
    fireEvent.click(within(screen.getByTestId('dfw-group-__untagged__')).getByRole('button', { name: /Expand/ }))
    fireEvent.click(within(screen.getByTestId('dfw-section-guest:qemu/103')).getByRole('button', { name: /Expand/ }))
  }

  it('drops nothing onto a rule of the engine', () => {
    openZoned()
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(ruleRow('u2'), { dataTransfer })
    fireEvent.dragOver(ruleRow('[pc-microseg]'), { dataTransfer })
    fireEvent.drop(ruleRow('[pc-microseg]'), { dataTransfer })
    expect(publishButton()).toHaveTextContent('Publish (0)')
    // Onto u1 it does move.
    fireEvent.dragStart(ruleRow('u2'), { dataTransfer })
    fireEvent.dragOver(ruleRow('u1'), { dataTransfer })
    fireEvent.drop(ruleRow('u1'), { dataTransfer })
    expect(publishButton()).toHaveTextContent('Publish (1)')
  })

  it('shows the guest options the engine owns as locked', async () => {
    openZoned()
    fireEvent.click(within(screen.getByTestId('dfw-section-guest:qemu/103')).getByRole('button', { name: /Actions of/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Firewall options' }))
    const selects = within(await screen.findByRole('dialog')).getAllByRole('combobox')
    // Firewall, inbound policy, outbound policy, inbound log level, outbound log level.
    expect(selects.map(c => c.getAttribute('aria-disabled') === 'true')).toEqual([true, true, false, true, false])
  })

  it('offers to discard the section a publish stopped on, from the alert', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      applied: 0, total: 1, scopes: { cluster: { digest: 'D1' } }, failed: { index: 0, kind: 'rule.edit', scope: 'cluster', code: 'DIGEST_CONFLICT', message: 'changed' },
    }), { status: 409 }))
    renderView()
    fireEvent.click(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' }))
    fireEvent.click(publishButton())
    const alert = await screen.findByTestId('dfw-publish-error')
    expect(alert).toHaveTextContent("Discard this section's changes, then publish again")
    fireEvent.click(within(alert).getByRole('button', { name: 'Discard this section' }))
    expect(publishButton()).toHaveTextContent('Publish (0)')
    expect(screen.queryByTestId('dfw-publish-error')).toBeNull()
    fetchSpy.mockRestore()
  })

  it('offers the same on the "changed in Proxmox" badge of a section', () => {
    const p = props()
    const view = renderView(p)
    fireEvent.click(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' }))
    view.rerender(<MicrosegWriteContext.Provider value><FirewallingView {...p} clusterRules={CLUSTER_RULES.map(r => ({ ...r, digest: 'D2' }))} /></MicrosegWriteContext.Provider>)
    const section = screen.getByTestId('dfw-section-cluster')
    expect(within(section).getByText('changed in Proxmox')).toBeInTheDocument()
    fireEvent.click(within(section).getByRole('button', { name: 'Discard this section' }))
    expect(publishButton()).toHaveTextContent('Publish (0)')
  })

  it('freezes the inline edits while a publish runs', async () => {
    let answer: (r: Response) => void = () => {}
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(resolve => { answer = resolve }))
    renderView()
    fireEvent.click(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' }))
    fireEvent.click(publishButton())
    await waitFor(() => expect(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' })).toBeDisabled())
    expect(within(ruleRow('Old Zabbix')).queryByRole('combobox')).toBeNull()
    answer(new Response(JSON.stringify({ applied: 1, total: 1, scopes: {} }), { status: 200 }))
    await waitFor(() => expect(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' })).toBeEnabled())
    fetchSpy.mockRestore()
  })
})

describe('Firewalling: round 2 details', () => {
  it('shows no default deny row for a zone that is not deployed', () => {
    renderView(props({ securityGroups: [{ group: 'pcz-web', rules: [{ pos: 0, type: 'in', action: 'ACCEPT', enable: 1, comment: '[pc-microseg] web -> web' }] }] }))
    fireEvent.click(within(screen.getByTestId('dfw-section-zone:pcz-web')).getByRole('button', { name: /Expand/ }))
    expect(screen.getByTestId('dfw-section-zone:pcz-web')).toHaveTextContent('Not deployed')
    expect(screen.queryByTestId('dfw-default-deny')).toBeNull()
  })

  it('offers no discard when the publish was only cut short: it says to publish again', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      applied: 0, total: 1, scopes: {}, failed: { index: 0, kind: 'rule.edit', scope: 'cluster', code: 'PVE_ERROR', message: 'timeout' },
    }), { status: 502 }))
    renderView()
    fireEvent.click(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' }))
    fireEvent.click(publishButton())
    const alert = await screen.findByTestId('dfw-publish-error')
    expect(alert).toHaveTextContent('timeout Publish again: the changes not applied are still in the draft.')
    expect(within(alert).queryByRole('button', { name: 'Discard this section' })).toBeNull()
    fetchSpy.mockRestore()
  })

  it('names the options when their digest stopped the publish', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      applied: 0, total: 1, scopes: {}, failed: { index: 0, kind: 'options.set', scope: 'cluster', code: 'DIGEST_CONFLICT', message: 'changed' },
    }), { status: 409 }))
    renderView()
    fireEvent.click(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' }))
    fireEvent.click(publishButton())
    expect(await screen.findByTestId('dfw-publish-error')).toHaveTextContent('the firewall options of a section were changed in Proxmox')
    fetchSpy.mockRestore()
  })

  it('reads a collapsed guest first when its options open, and locks what the engine owns on a zone member', async () => {
    const p = props()
    renderView(p)
    fireEvent.click(within(screen.getByTestId('dfw-group-100')).getByRole('button', { name: /Expand/ }))
    // vm-102 carries the pc-db tag of the deployed db zone; its rules were never read.
    fireEvent.click(within(screen.getByTestId('dfw-section-guest:qemu/102')).getByRole('button', { name: /Actions of/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Firewall options' }))
    const selects = within(await screen.findByRole('dialog')).getAllByRole('combobox')
    expect(p.loadGuestRules).toHaveBeenCalledTimes(1)
    expect(selects.map(c => c.getAttribute('aria-disabled') === 'true')).toEqual([true, true, false, true, false])
  })

  it('freezes Save of the options and the section discard while a publish runs', async () => {
    let answer: (r: Response) => void = () => {}
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(resolve => { answer = resolve }))
    renderView()
    fireEvent.click(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' }))
    fireEvent.click(publishButton())
    fireEvent.click(within(screen.getByTestId('dfw-section-cluster')).getByRole('button', { name: /Actions of/ }))
    expect(await screen.findByRole('menuitem', { name: 'Discard the changes of this section' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Firewall options' }))
    expect(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' })).toBeDisabled()
    answer(new Response(JSON.stringify({ applied: 1, total: 1, scopes: {} }), { status: 200 }))
    fetchSpy.mockRestore()
  })
})

describe('Firewalling for a read-only user', () => {
  it('disables Publish, Add rule, Add section, the switches and the action, with the reason', async () => {
    renderView(props(), false)
    expect(publishButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add section' })).toBeDisabled()
    const ssh = ruleRow('Admin SSH')
    for (const s of within(ssh).getAllByRole('switch')) expect(s).toBeDisabled()
    expect(within(ssh).queryByRole('combobox')).toBeNull()
    expect(within(ssh).queryByRole('button', { name: 'Admin SSH' })).toBeNull()
    expect(ssh).toHaveAttribute('draggable', 'false')
    fireEvent.mouseOver(publishButton().parentElement!)
    expect(await screen.findByText('Read-only: you need node management rights')).toBeInTheDocument()
  })

  it('shows the cluster options read-only: the firewall switch and the IN/OUT default policies disabled, with the reason', async () => {
    renderView(props({ clusterOptions: { enable: 1, policy_in: 'DROP', policy_out: 'ACCEPT' } }), false)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Cluster firewall options' }))
    const dialog = await screen.findByRole('dialog')
    const selects = within(dialog).getAllByRole('combobox')
    expect(selects).toHaveLength(3)
    for (const select of selects) expect(select).toHaveAttribute('aria-disabled', 'true')
    expect(within(dialog).getByText('DROP')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.mouseOver(selects[1].closest('span')!)
    expect(await screen.findByText('Read-only: you need node management rights')).toBeInTheDocument()
  })

  it('leaves them enabled with the right', () => {
    renderView()
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add section' })).toBeEnabled()
    expect(ruleRow('Admin SSH')).toHaveAttribute('draggable', 'true')
    expect(within(ruleRow('Admin SSH')).getByRole('button', { name: 'Admin SSH' })).toBeEnabled()
  })

  it('changes a cluster default policy in the draft with the right', async () => {
    renderView(props({ clusterOptions: { enable: 1, policy_in: 'DROP', policy_out: 'ACCEPT' } }))
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Cluster firewall options' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[1])
    fireEvent.click(await screen.findByRole('option', { name: 'ACCEPT' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(publishButton()).toHaveTextContent('Publish (1)'))
  })
})
