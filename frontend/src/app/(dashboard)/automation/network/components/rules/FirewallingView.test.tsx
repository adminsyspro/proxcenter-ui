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
  getVMOptions: vi.fn(),
  toast: vi.fn(),
  events: [] as any[],
  policy: null as any,
  /** The last applied revision (what the rules on Proxmox come from). */
  snapshot: null as any,
  api: { saveFlow: vi.fn(), deleteFlow: vi.fn(), setZoneState: vi.fn() },
  reloadPolicy: vi.fn(),
}))

vi.mock('@/lib/api/firewall', () => ({
  getNodeRules: (...a: any[]) => h.getNodeRules(...a),
  getNodeOptions: (...a: any[]) => h.getNodeOptions(...a),
  getVMOptions: (...a: any[]) => h.getVMOptions(...a),
}))
vi.mock('@/lib/microseg/useMicroseg', () => ({
  useMicrosegPolicy: () => ({ data: h.policy, reload: h.reloadPolicy }),
  // Every run is already finished: what it changed is refreshed at once.
  useMicrosegRun: () => ({ run: { status: 'done', result: { done: [], failed: [], not_run: [] } }, done: true, error: null }),
  FATAL_CODES: new Set(),
}))
vi.mock('@/lib/microseg/api', async orig => ({ ...(await orig() as object), microsegApi: () => h.api }))

/** The micro-segmentation draft: zones db (enforce) and app (observe), one flow app -> db tcp/5432. */
const draftPolicy = (pending = false) => ({
  policy: { id: 'p1', tag_prefix: 'pc-', settings: { ready_after_hours: 24 } },
  version: 3,
  zones: [
    { id: 'z-db', name: 'db', label: 'Databases', color: '#f00', enforcement: 'guest', vnet_id: '', state: 'enforce', isolate_members: false, observe_since: null },
    { id: 'z-app', name: 'app', label: 'Apps', color: '#0f0', enforcement: 'guest', vnet_id: '', state: 'observe', isolate_members: false, observe_since: null },
  ],
  flows: [{ id: 'f1', policy_id: 'p1', src_zone_id: 'z-app', src_cidr: '', dst_zone_id: 'z-db', dst_cidr: '', proto: 'tcp', dport: '5432', comment: '', origin: 'manual', created_by: 'x' }],
  pending_members: [],
  pending_changes: pending,
  last_revision: { id: 'rev1', version: 2, author: 'x', created_at: '2026-11-03T10:00:00Z' },
})
vi.mock('@/lib/microseg/useLastRevision', () => ({
  useLastRevisionSnapshot: () => ({ revision: { id: 'rev1', snapshot: h.snapshot }, loading: false }),
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
    initialScope: 'all', reloadFirewall: vi.fn(), reloadGuests: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

/** Renders the tab and opens the cluster section (every section starts collapsed), unless `collapsed`. */
const renderView = (p = props(), canWrite = true, collapsed = false) => {
  const view = renderWithProviders(<MicrosegWriteContext.Provider value={canWrite}><FirewallingView {...p} /></MicrosegWriteContext.Provider>)
  if (!collapsed) fireEvent.click(within(screen.getByTestId('dfw-section-cluster')).getByRole('button', { name: /Expand/ }))
  return view
}

const ruleRow = (name: string) => screen.getAllByTestId('dfw-rule-row').find(r => within(r).queryByText(name))!
const publishButton = () => screen.getByRole('button', { name: /^Publish \(\d+\)$/ })

beforeEach(() => {
  vi.clearAllMocks()
  try { sessionStorage.clear() } catch { /* storage blocked */ }
  h.policy = draftPolicy()
  h.snapshot = { tag_prefix: 'pc-', zones: draftPolicy().zones, flows: draftPolicy().flows }
  h.api.saveFlow.mockResolvedValue({ version: 4 })
  h.api.deleteFlow.mockResolvedValue({ version: 4 })
  h.reloadPolicy.mockResolvedValue(undefined)
  h.getVMOptions.mockResolvedValue({ enable: 1, policy_in: 'DROP', log_level_in: 'info' })
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
    expect(within(zone).getByText('Enforced')).toBeInTheDocument()
    expect(within(zone).getByText('managed by the engine')).toBeInTheDocument()
    // No link away: the zone is edited here (its Add rule is a new flow into it).
    expect(within(zone).queryByRole('button', { name: /edit in Micro-segmentation/ })).toBeNull()
    expect(within(zone).getByRole('button', { name: 'Add a rule to Micro-segmentation · zone db' })).toBeInTheDocument()
    expect(screen.getByTestId('dfw-section-cluster')).toHaveTextContent('Cluster rules')
    expect(screen.getByTestId('dfw-section-host:pve1')).toHaveTextContent('Rules read when opened')
    expect(screen.getByTestId('dfw-group-100')).toHaveTextContent('VLAN 100 · 2 VMs')
    expect(screen.getByTestId('dfw-group-100')).toHaveTextContent('1 protected by the micro-segmentation')
    // The sg-web group is no section: only the zone groups of the engine are.
    expect(screen.queryByTestId('dfw-section-zone:sg-web')).toBeNull()
  })

  it('reads the rows of a managed section as locked, the zone hits on its default deny row, numbered across the table', async () => {
    renderView()
    fireEvent.click(within(screen.getByTestId('dfw-section-zone:pcz-db')).getByRole('button', { name: /Expand/ }))
    const appRule = ruleRow('[pc-microseg] app -> db')
    expect(within(appRule).queryByRole('checkbox')).toBeNull()
    expect(within(appRule).queryByRole('combobox')).toBeNull()
    expect(within(appRule).getByTestId('dfw-hits')).toHaveTextContent('-')
    expect(within(ruleRow('[pc-microseg] db -> db')).getByTestId('dfw-hits')).toHaveTextContent('-')
    const deny = screen.getByTestId('dfw-default-deny')
    expect(deny).toHaveTextContent('Zone default deny')
    expect(deny).toHaveTextContent('Block')
    expect(within(deny).getByTestId('dfw-hits')).toHaveTextContent('3')
    expect(within(deny).queryByRole('checkbox')).toBeNull()
    // Zone rules 1 and 2, then the cluster's from 3.
    // Numbered per section, from 1: the zone's 1 and 2, the cluster's 1 and 2.
    expect(within(ruleRow('[pc-microseg] app -> db')).getByRole('switch', { name: 'Rule 1 enabled' })).toBeInTheDocument()
    expect(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' })).toBeInTheDocument()
    // A rule of the engine carries a lock and no drag handle.
    expect(appRule.querySelector('.ri-draggable')).toBeNull()
    expect(ruleRow('Admin SSH').querySelector('.ri-draggable')).not.toBeNull()
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

describe('Firewalling: checkboxes (bench report: "the boxes cannot be checked")', () => {
  const ZONED = guest(104, {
    name: 'zoned', rulesLoaded: true, vlans: [],
    rules: [
      { pos: 0, type: 'group', action: 'pcz-db', enable: 1, comment: '[pc-microseg]', digest: 'G' },
      { pos: 1, type: 'in', action: 'ACCEPT', enable: 1, comment: 'u1', digest: 'G' },
      { pos: 2, type: 'in', action: 'ACCEPT', enable: 1, comment: 'u2', digest: 'G' },
      { pos: 3, type: 'in', action: 'ACCEPT', enable: 1, log: 'info', comment: '[pc-microseg] observe', digest: 'G' },
    ],
  })
  const bar = () => screen.getByTestId('dfw-actions')

  it('shows no checkbox on an engine row nor on a zone group header', () => {
    renderView()
    const zone = screen.getByTestId('dfw-section-zone:pcz-db')
    expect(within(zone).queryByRole('checkbox')).toBeNull()
    fireEvent.click(within(zone).getByRole('button', { name: /Expand/ }))
    for (const name of ['[pc-microseg] app -> db', '[pc-microseg] db -> db']) expect(within(ruleRow(name)).queryByRole('checkbox')).toBeNull()
  })

  it('shows no section or table checkbox while no rule can be checked, and a quiet "No rules" caption', () => {
    renderView(props({ clusterRules: [] }))
    expect(within(screen.getByTestId('dfw-section-cluster')).queryByRole('checkbox')).toBeNull()
    // A host whose rules were never read: nothing to check either.
    expect(within(screen.getByTestId('dfw-section-host:pve1')).queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Select every rule shown' })).toBeNull()
    const empty = screen.getByTestId('dfw-empty')
    expect(empty).toHaveTextContent('No rules')
    // Under the Name column: four leading cells, then the caption.
    expect(empty.querySelectorAll('td')[0]).toHaveAttribute('colspan', '4')
  })

  it('a read-only user sees the section checkbox of a section with rules, disabled', () => {
    renderView(props(), false)
    expect(within(screen.getByTestId('dfw-section-cluster')).getByRole('checkbox')).toBeDisabled()
  })

  it('a section header checks only the selectable rules of a guest, collapsed or not; the head checkbox likewise', () => {
    renderView(props({ guests: [ZONED], clusterRules: [] }), true, true)
    fireEvent.click(within(screen.getByTestId('dfw-group-__untagged__')).getByRole('button', { name: /Expand/ }))
    const header = within(screen.getByTestId('dfw-section-guest:qemu/104')).getByRole('checkbox')
    expect(header).toBeEnabled()
    fireEvent.click(header)
    expect(bar()).toHaveTextContent('2 rules selected')
    fireEvent.click(within(screen.getByTestId('dfw-section-guest:qemu/104')).getByRole('button', { name: /Expand/ }))
    expect(within(ruleRow('u1')).getByRole('checkbox')).toBeChecked()
    expect(within(ruleRow('[pc-microseg]')).queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every rule shown' }))
    expect(bar()).toHaveTextContent('No rule selected')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every rule shown' }))
    expect(bar()).toHaveTextContent('2 rules selected')
  })

  it("a user rule's checkbox toggles and lights the bulk actions", () => {
    renderView()
    const box = within(ruleRow('Admin SSH')).getByRole('checkbox', { name: 'Select rule 1' })
    fireEvent.click(box)
    expect(box).toBeChecked()
    for (const name of ['Enable', 'Disable', 'Clone', 'Move to section', 'Delete']) expect(within(bar()).getByRole('button', { name })).toBeEnabled()
    fireEvent.click(box)
    expect(box).not.toBeChecked()
    expect(within(bar()).getByRole('button', { name: 'Enable' })).toBeDisabled()
  })
})

describe('Firewalling: final recette details', () => {
  it('opens with every section collapsed, the cluster too', () => {
    renderView(props(), true, true)
    expect(within(screen.getByTestId('dfw-section-cluster')).getByRole('button', { name: /Expand/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryAllByTestId('dfw-rule-row')).toHaveLength(0)
  })

  it('shows a zone guest options as Proxmox stores them, and the Proxmox default for what it does not store', async () => {
    renderView()
    fireEvent.click(within(screen.getByTestId('dfw-group-100')).getByRole('button', { name: /Expand/ }))
    fireEvent.click(within(screen.getByTestId('dfw-section-guest:qemu/102')).getByRole('button', { name: /Actions of/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Firewall options' }))
    const dialog = await screen.findByRole('dialog')
    expect(h.getVMOptions).toHaveBeenCalledTimes(1)
    // Firewall on, inbound DROP and info as stored; outbound ACCEPT and nolog as Proxmox applies them.
    expect(within(dialog).getAllByRole('combobox').map(c => c.textContent)).toEqual(['On', 'DROP', 'ACCEPT', 'info', 'nolog'])
    // Opening and saving without a change makes no change to publish.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(publishButton()).toHaveTextContent('Publish (0)')
  })

  it('keeps the summary of the last publish next to the unpublished count until the draft changes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ applied: 1, total: 1, scopes: {} }), { status: 200 }))
    renderView()
    fireEvent.click(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' }))
    fireEvent.click(publishButton())
    expect(await screen.findByTestId('dfw-publish-summary')).toHaveTextContent('Last publish: 1 of 1 changes applied')
    expect(h.toast).toHaveBeenCalledWith('1 change published', 'success')
    fireEvent.click(within(ruleRow('Old Zabbix')).getByRole('switch', { name: 'Rule 2 enabled' }))
    expect(screen.queryByTestId('dfw-publish-summary')).toBeNull()
    fetchSpy.mockRestore()
  })

  it('says where the last publish stopped', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      applied: 0, total: 1, scopes: {}, failed: { index: 0, kind: 'rule.edit', scope: 'cluster', code: 'PVE_ERROR', message: 'timeout' },
    }), { status: 502 }))
    renderView()
    fireEvent.click(within(ruleRow('Admin SSH')).getByRole('switch', { name: 'Rule 1 enabled' }))
    fireEvent.click(publishButton())
    expect(await screen.findByTestId('dfw-publish-summary')).toHaveTextContent('Last publish: 0 of 1 changes applied, stopped on rule.edit in cluster')
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

describe('Firewalling: creating a rule', () => {
  const keep = async () => {
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Comment'), { target: { value: 'created here' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep in the draft' }))
  }

  it('each user section has its Add rule; on a collapsed section it opens it and the editor', async () => {
    renderView(props(), true, true)
    fireEvent.click(screen.getByRole('button', { name: 'Add a rule to Cluster rules' }))
    expect(within(await screen.findByRole('dialog')).queryByRole('combobox', { name: /Applies to/ })).toBeNull()
    await keep()
    // The section is open and the rule is the last of the cluster's.
    const rows = screen.getAllByTestId('dfw-rule-row').map(r => r.textContent)
    expect(rows.at(-1)).toContain('created here')
    expect(publishButton()).toHaveTextContent('Publish (1)')
  })

  it('a host section read first: its Add rule reads the rules, the editor keeps the rule once read', async () => {
    h.getNodeRules.mockResolvedValue([])
    h.getNodeOptions.mockResolvedValue({ enable: 1 })
    const p = props()
    renderView(p, true, true)
    fireEvent.click(screen.getByRole('button', { name: 'Add a rule to Host pve1' }))
    await waitFor(() => expect(h.getNodeRules).toHaveBeenCalledWith('c1', 'pve1'))
    expect(p.setHostRulesByNode).toHaveBeenCalled()
  })

  it('an empty section offers "No rules · Add a rule"', async () => {
    renderView(props({ clusterRules: [] }))
    const empty = screen.getByTestId('dfw-empty')
    expect(empty).toHaveTextContent('No rules · Add a rule')
    fireEvent.click(within(empty).getByRole('button', { name: 'Add a rule' }))
    await keep()
    expect(publishButton()).toHaveTextContent('Publish (1)')
  })

  it('the toolbar Add rule asks where: the cluster preselected, a host or a guest shown can be picked', async () => {
    h.getNodeRules.mockResolvedValue([])
    h.getNodeOptions.mockResolvedValue({ enable: 1 })
    renderView(props(), true, true)
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    const dialog = await screen.findByRole('dialog')
    const scope = within(dialog).getByRole('combobox', { name: /Applies to/ })
    expect(scope).toHaveTextContent('Cluster rules')
    fireEvent.mouseDown(scope)
    const list = await screen.findByRole('listbox')
    expect(within(list).getByText('Hosts')).toBeInTheDocument()
    expect(within(list).getByRole('option', { name: 'vm-101 (101) · pve1' })).toBeInTheDocument()
    fireEvent.click(within(list).getByRole('option', { name: 'Host pve2' }))
    // The host's rules are read; the rule can be kept once they are.
    await waitFor(() => expect(h.getNodeRules).toHaveBeenCalledWith('c1', 'pve2'))
  })
})

describe('Firewalling: the zones edited in place (micro-segmentation draft)', () => {
  const openDb = () => fireEvent.click(within(screen.getByTestId('dfw-section-zone:pcz-db')).getByRole('button', { name: /Expand/ }))

  it("the zone's Add rule opens the flow dialog with the zone as destination", async () => {
    renderView()
    fireEvent.click(within(screen.getByTestId('dfw-section-zone:pcz-db')).getByRole('button', { name: 'Add a rule to Micro-segmentation · zone db' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('New flow')
    expect(within(dialog).getByRole('combobox', { name: /Destination zone/ })).toHaveTextContent(/db/)
  })

  it('a rule compiled from a flow is edited and deleted as that flow; one matching none keeps its lock', async () => {
    renderView()
    openDb()
    const appRule = ruleRow('[pc-microseg] app -> db')
    expect(within(appRule).queryByLabelText('Proxmox was changed by hand or the engine has not re-applied yet')).toBeNull()
    // Still the engine's rule: the lock stays next to its menu.
    expect(within(appRule).getByLabelText('The engine’s rule: edit it as its flow (menu or double-click)')).toBeInTheDocument()
    // The rule of the fixture without a source matches no flow and no zone setting: a drift, locked.
    expect(within(ruleRow('[pc-microseg] db -> db')).getByLabelText('Proxmox was changed by hand or the engine has not re-applied yet')).toBeInTheDocument()

    fireEvent.click(within(appRule).getByRole('button', { name: 'Actions of the flow' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit the flow' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Edit flow')
    expect(within(dialog).getByRole('textbox', { name: /Port/ })).toHaveValue('5432')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(h.api.saveFlow).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1', version: 3, dst_zone_id: 'z-db', src_zone_id: 'z-app', dport: '5432' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(within(ruleRow('[pc-microseg] app -> db')).getByRole('button', { name: 'Actions of the flow' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete the flow' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete this flow?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(h.api.deleteFlow).toHaveBeenCalledWith('f1', 3))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Never through the Firewalling publish.
    expect(publishButton()).toHaveTextContent('Publish (0)')
  })

  it('a flow edited since the last apply: its deployed row edits the draft flow and says it changed', async () => {
    h.policy = { ...draftPolicy(true), flows: [{ ...draftPolicy().flows[0], dport: '5433' }] }
    renderView()
    openDb()
    const row = ruleRow('[pc-microseg] app -> db')
    expect(within(row).getByText('changed')).toBeInTheDocument()
    fireEvent.doubleClick(row)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('textbox', { name: /Port/ })).toHaveValue('5433')
  })

  it('a flow deleted from the draft: its deployed row is struck, locked, without Edit or Delete', () => {
    h.policy = { ...draftPolicy(true), flows: [] }
    renderView()
    openDb()
    const row = ruleRow('[pc-microseg] app -> db')
    expect(within(row).getByLabelText('Removal pending (next apply)')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Actions of the flow' })).toBeNull()
    expect(within(row).getByText('[pc-microseg] app -> db')).toHaveStyle({ textDecoration: 'line-through' })
  })

  it('a zone renamed in the draft keeps its Add rule and its state chip', () => {
    h.policy = { ...draftPolicy(), zones: draftPolicy().zones.map(z => (z.id === 'z-db' ? { ...z, name: 'databases' } : z)) }
    renderView()
    const section = screen.getByTestId('dfw-section-zone:pcz-db')
    expect(within(section).getByRole('button', { name: 'Add a rule to Micro-segmentation · zone db' })).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Change the state of zone databases' })).toBeInTheDocument()
  })

  it('a double-click on a control of the row is that control, not an edit', () => {
    renderView()
    openDb()
    const row = ruleRow('[pc-microseg] app -> db')
    fireEvent.doubleClick(within(row).getByRole('button', { name: 'Actions of the flow' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a finished run reloads the firewall data once and the draft once, no loop (recette D1)', async () => {
    h.api.setZoneState.mockResolvedValue({ run_id: 'r1' })
    const p = props()
    renderView(p)
    fireEvent.click(within(screen.getByTestId('dfw-section-zone:pcz-db')).getByRole('button', { name: 'Change the state of zone db' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Observe' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Observe' }))
    await waitFor(() => expect(p.reloadFirewall).toHaveBeenCalledTimes(1))
    const policyReads = h.reloadPolicy.mock.calls.length
    // A second of re-renders and timers: no more reload.
    await new Promise(resolve => setTimeout(resolve, 1000))
    expect(p.reloadFirewall).toHaveBeenCalledTimes(1)
    expect(h.reloadPolicy.mock.calls.length).toBe(policyReads)
  })

  it('a state change is refused while the micro-segmentation draft has pending changes (UA30)', async () => {
    h.policy = draftPolicy(true)
    renderView()
    fireEvent.click(within(screen.getByTestId('dfw-section-zone:pcz-db')).getByRole('button', { name: 'Change the state of zone db' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Observe' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/Apply or discard your (\d+ )?pending changes? first/)
    expect(within(dialog).getByRole('button', { name: 'View plan' })).toBeInTheDocument()
  })

  it('a double-click on a flow rule opens its flow', async () => {
    renderView()
    openDb()
    fireEvent.doubleClick(ruleRow('[pc-microseg] app -> db'))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Edit flow')
  })

  it('shows the micro-segmentation pending changes above the table, apart from the Firewalling publish', () => {
    h.policy = draftPolicy(true)
    renderView()
    const bar = screen.getByTestId('dfw-microseg-pending')
    expect(bar).toHaveTextContent(/Micro-segmentation draft: (\d+ u|U)napplied changes?/)
    expect(within(bar).getByRole('button', { name: 'View plan' })).toBeEnabled()
    expect(publishButton()).toHaveTextContent('Publish (0)')
  })

  it("the zone's state chip opens the state menu of the Policy tab", async () => {
    renderView()
    fireEvent.click(within(screen.getByTestId('dfw-section-zone:pcz-db')).getByRole('button', { name: 'Change the state of zone db' }))
    expect(await screen.findByRole('menuitem', { name: 'Observe' })).toBeInTheDocument()
  })

  it('a guest of a zone: its zone group rule opens the zone section', () => {
    const zoned = guest(105, {
      name: 'member', rulesLoaded: true, vlans: [],
      rules: [{ pos: 0, type: 'group', action: 'pcz-db', enable: 1, comment: '[pc-microseg]', digest: 'G' }],
    })
    renderView(props({ guests: [zoned] }), true, true)
    fireEvent.click(within(screen.getByTestId('dfw-group-__untagged__')).getByRole('button', { name: /Expand/ }))
    fireEvent.click(within(screen.getByTestId('dfw-section-guest:qemu/105')).getByRole('button', { name: /Expand/ }))
    fireEvent.click(within(ruleRow('[pc-microseg]')).getByRole('button', { name: 'Edit the zone' }))
    expect(within(screen.getByTestId('dfw-section-zone:pcz-db')).getByRole('button', { name: /Collapse/ })).toBeInTheDocument()
  })

  it('a read-only user sees the zone controls disabled', () => {
    h.policy = draftPolicy(true)
    renderView(props(), false)
    openDb()
    expect(within(screen.getByTestId('dfw-section-zone:pcz-db')).getByRole('button', { name: 'Add a rule to Micro-segmentation · zone db' })).toBeDisabled()
    expect(within(screen.getByTestId('dfw-section-zone:pcz-db')).getByRole('button', { name: 'Change the state of zone db' })).toBeDisabled()
    expect(within(ruleRow('[pc-microseg] app -> db')).getByRole('button', { name: 'Actions of the flow' })).toBeDisabled()
    expect(within(screen.getByTestId('dfw-microseg-pending')).getByRole('button', { name: 'View plan' })).toBeDisabled()
  })
})

describe('Firewalling for a read-only user', () => {
  it('disables Publish, Add rule (toolbar and sections), the switches and the action, with the reason', async () => {
    renderView(props(), false)
    expect(publishButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add a rule to Cluster rules' })).toBeDisabled()
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
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull()
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
