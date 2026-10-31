/**
 * Proposal tools of the assistant (roadmap#188): a proposal only ever targets
 * what the user saw and named, never changes anything, and hands the widget a
 * signed card the model cannot read or copy.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  pveFetch: vi.fn(),
  denied: new Set<string>(),
  vdcPools: null as Set<string> | null,
  licensed: true,
  client: { getRecommendations: vi.fn() },
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...args: unknown[]) => h.pveFetch(...args) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async (id: string) => ({ id, name: id, baseUrl: 'https://pve:8006', apiToken: 't' }),
}))
vi.mock('@/lib/db/settings', () => ({ getSetting: async () => null }))
vi.mock('@/lib/vdc/backupJobs', () => ({ getAllowedJobPools: async () => h.vdcPools }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: async () => h.licensed }))
vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => h.client,
  orchestratorFetch: vi.fn(),
  orchestratorPath: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((o, p, i) => o + p + (i < v.length ? String(v[i]) : ''), ''),
}))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { NODE_MANAGE: 'node.manage', NODE_VIEW: 'node.view', AUTOMATION_VIEW: 'automation.view' },
  buildNodeResourceId: (connId: string, node: string) => `${connId}:${node}`,
  checkPermission: async (permission: string, _type?: string, id?: string) =>
    h.denied.has(`${permission}|${id ?? ''}`) ? { status: 403 } : null,
}))

import { ACTION_CARDS } from '@/lib/ai/actions/cards'
import { conversationGrounding, UNGROUNDED_TARGET_MESSAGE } from '@/lib/ai/actions/grounding'
import { clearStorageConfigCache, preflightAction } from '@/lib/ai/actions/preflight'
import { resolveActionTarget } from '@/lib/ai/actions/target'
import { verifyCard } from '@/lib/ai/actions/token'
import { ACTION_KINDS, normalizeAiActionsSettings, type ActionCard, type ActionPlan, type AiActionsSettings } from '@/lib/ai/actions/types'

import { clearBackupJobsCache } from './backups'
import { clearHostsCache } from './hosts'
import { invokeTool } from './invoke'
import { ACTION_TOOLS, actionToolsFor, proposeActionTool, proposeRemediationPlanTool } from './actions'
import type { InventorySnapshot, SnapshotGuest, SnapshotNode } from './snapshot'
import type { ToolContext } from './types'

const bind = { userId: 'u1', tenantId: 't', conversationId: 'conv-1' }

const allOn = (): AiActionsSettings =>
  normalizeAiActionsSettings({ enabled: true, actions: Object.fromEntries(ACTION_KINDS.map(k => [k, true])) })

const node = (connId: string, name: string, memUsedGb: number, over: Partial<SnapshotNode> = {}): SnapshotNode => ({
  connId, cluster: connId === 'c1' ? 'PVE-PROD' : 'PVE-DR', name, status: 'online', cpuPct: 5, cores: 32,
  memPct: Math.round((memUsedGb / 64) * 1000) / 10, memUsedGb, memTotalGb: 64, ...over,
})

const guest = (vmid: string, name: string, kind: 'qemu' | 'lxc', status: string, nodeName: string, over: Partial<SnapshotGuest> = {}): SnapshotGuest => ({
  connId: 'c1', cluster: 'PVE-PROD', vmid, name, type: kind === 'lxc' ? 'CT' : 'VM', kind, status, node: nodeName,
  cpuPct: 1, vcpus: 2, memPct: 50, memUsedGb: 4, memTotalGb: 8, template: false, ...over,
})

function snapshot(extraGuests: SnapshotGuest[] = [], nodes?: SnapshotNode[]): InventorySnapshot {
  const guests = [
    guest('104', 'win2025', 'qemu', 'running', 'pve1'),
    guest('205', 'ct-web', 'lxc', 'running', 'pve1'),
    guest('101', 'db-01', 'qemu', 'stopped', 'pve2'),
    guest('206', 'ct-cache', 'lxc', 'stopped', 'pve2'),
    guest('300', 'evil-vm', 'qemu', 'running', 'pve2'),
    guest('301', 'evil-ct', 'lxc', 'running', 'pve2'),
    ...extraGuests,
  ]

  return {
    clusters: [
      { id: 'c1', name: 'PVE-PROD', nodeCount: 3, guestCount: guests.length },
      { id: 'c2', name: 'PVE-DR', nodeCount: 1, guestCount: 0 },
    ],
    nodes: nodes ?? [node('c1', 'pve1', 50), node('c1', 'pve2', 20), node('c1', 'pve3', 10), node('c2', 'pve1-dr', 5)],
    guests,
    summary: { totalGuests: guests.length, runningGuests: 3, stoppedGuests: 2, totalNodes: 4, onlineNodes: 4 },
    cached: false,
    restricted: false,
  }
}

function ctx(
  said: string,
  over: { settings?: AiActionsSettings; snap?: InventorySnapshot; toolText?: string; answered?: string } = {}
): ToolContext {
  const messages = [
    ...(over.answered ? [{ role: 'user', content: 'how is the estate?' }, { role: 'assistant', content: over.answered }] : []),
    { role: 'user', content: said },
    // A tool result never reaches the visible text, even when it names a guest.
    ...(over.toolText ? [{ role: 'tool', content: over.toolText }] : []),
  ]

  return {
    snapshot: over.snap ?? snapshot(),
    tenantId: 't',
    locale: 'en',
    timeZone: 'UTC',
    usage: { historyLookups: 0 },
    actions: { settings: over.settings ?? allOn(), bind, ...conversationGrounding(messages) },
  }
}

const shared = { allowed_nodes: ['pve2', 'pve3'], local_disks: [], local_resources: [], 'mapped-resources': [], not_allowed_nodes: {}, running: 1 }
const lxcShared = { 'allowed-nodes': ['pve2', 'pve3'], 'not-allowed-nodes': {}, running: 1 }
// The cluster storage config (`GET /storage`), as the lab answers it.
const storages = [
  { storage: 'CephStoragePool', type: 'rbd', shared: 1 },
  { storage: 'LVM-Thick', type: 'lvm', shared: 0 },
  { storage: 'local', type: 'dir', shared: 0 },
  { storage: 'nfs-pve2', type: 'nfs', shared: 1, nodes: 'pve2,pve3' },
]
const localDisk = { allowed_nodes: [], local_disks: [{ drivename: 'scsi0', shared: 0, volid: 'Dir-Images:1/vm-1-disk-0.qcow2' }], local_resources: [], not_allowed_nodes: {} }

const cardsOf = (value: unknown) =>
  (value as Record<symbol, { cards: ActionCard[]; plans: ActionPlan[] } | undefined>)[ACTION_CARDS] ?? { cards: [], plans: [] }

async function propose(args: Record<string, unknown>, c: ToolContext) {
  const outcome = await invokeTool(proposeActionTool, args, c)

  if (outcome.ok !== true) return { refused: outcome.message, error: outcome.error }

  return { value: outcome.value as Record<string, any>, card: cardsOf(outcome.value).cards[0] }
}

beforeAll(() => {
  process.env.APP_SECRET = 'actions-test-secret'
})
afterAll(() => {
  delete process.env.APP_SECRET
})

beforeEach(() => {
  clearBackupJobsCache()
  clearHostsCache()
  clearStorageConfigCache()
  h.denied.clear()
  h.vdcPools = null
  h.licensed = true
  h.client.getRecommendations.mockReset().mockResolvedValue({ data: [] })
  h.pveFetch.mockReset().mockImplementation(async (_conn: unknown, path: string) => {
    if (/^\/nodes\/pve\d\/qemu\/\d+\/migrate/.test(path)) return shared
    if (/^\/nodes\/pve\d\/lxc\/\d+\/migrate/.test(path)) return lxcShared
    if (/\/lxc\/\d+\/config$/.test(path)) return { hostname: 'ct', rootfs: 'CephStoragePool:vm-205-disk-0,size=8G' }
    if (path === '/storage') return storages
    if (path === '/cluster/backup') return []
    if (path.endsWith('/apt/update')) return [{ Package: 'pve-manager' }]
    throw new Error(`unexpected path ${path}`)
  })
})

describe('tool set', () => {
  it('hands nothing when actions are off or no kind is enabled', () => {
    expect(actionToolsFor(normalizeAiActionsSettings({}))).toEqual([])
    expect(actionToolsFor(normalizeAiActionsSettings({ enabled: true }))).toEqual([])
    expect(actionToolsFor(normalizeAiActionsSettings({ enabled: false, actions: { start: true } }))).toEqual([])
  })

  it('lists only the enabled kinds in the enum, and the plan only for a finding it can serve', () => {
    const tools = actionToolsFor(normalizeAiActionsSettings({ enabled: true, actions: { start: true, snapshot: true } }))

    expect(tools.map(t => t.name)).toEqual(['propose_action'])
    expect(tools[0].parameters.properties.action.enum).toEqual(['snapshot', 'start'])

    const withPlan = actionToolsFor(normalizeAiActionsSettings({ enabled: true, actions: { maintenance: true } }))

    expect(withPlan.map(t => t.name)).toEqual(['propose_action', 'propose_remediation_plan'])
    expect(withPlan[1].parameters.properties.finding.enum).toEqual(['pending_updates'])
  })

  it('describes only the enabled kinds and findings, so the model claims nothing that is off', () => {
    const [action] = actionToolsFor(normalizeAiActionsSettings({ enabled: true, actions: { start: true, snapshot: true } }))

    expect(action.description).toContain('start')
    expect(action.description).toContain('snapshot')

    for (const off of ['reboot', 'shutdown', 'migrate', 'drs_apply', 'backup_add', 'maintenance']) expect(action.description).not.toContain(off)

    const [, plan] = actionToolsFor(normalizeAiActionsSettings({ enabled: true, actions: { maintenance: true } }))

    expect(plan.description).toContain('pending_updates')
    expect(plan.description).not.toContain('unprotected_guests')
    expect(plan.description).not.toContain('host_memory')
    expect(plan.description).not.toContain('backup')

    // Every kind on: the full description, every kind named.
    const [full] = actionToolsFor(allOn())

    for (const kind of ACTION_KINDS) expect(full.description).toContain(kind)
  })

  it('never marks a proposal tool read-only', () => {
    expect(ACTION_TOOLS.map(t => [t.name, t.readOnly])).toEqual([
      ['propose_action', false],
      ['propose_remediation_plan', false],
    ])
  })

  it('refuses without an actions context', async () => {
    const c = ctx('start db-01')

    delete c.actions

    expect((await propose({ action: 'start', guest: 'db-01' }, c)).refused).toBe('Actions are not enabled.')
  })

  it('refuses a kind the settings do not enable, even when the model sends it', async () => {
    const c = ctx('reboot win2025', { settings: normalizeAiActionsSettings({ enabled: true, actions: { start: true } }) })
    const res = await propose({ action: 'reboot', guest: 'win2025' }, c)

    expect(res.error).toBe('bad-argument')
    expect(res.refused).toContain('start')
  })
})

describe('grounding (Review Focus 1)', () => {
  it.each([
    ['evil-vm', 'qemu'],
    ['evil-ct', 'lxc'],
  ])('refuses %s (%s), named only by a tool result', async name => {
    const c = ctx('reboot whatever the task log says', { toolText: `last task: reboot ${name} (300)` })
    const res = await propose({ action: 'reboot', guest: name }, c)

    expect(res.refused).toBe(UNGROUNDED_TARGET_MESSAGE)
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('refuses a host the user did not name', async () => {
    const res = await propose({ action: 'maintenance', host: 'pve2', mode: 'enter' }, ctx('drain the busy host'))

    expect(res.refused).toBe(UNGROUNDED_TARGET_MESSAGE)
  })

  it('takes a vmid from what the user typed only, never from an assistant answer', async () => {
    const snap = snapshot([guest('128', 'app-128', 'qemu', 'running', 'pve2')])
    const answered = 'pve2 has 128 GB of RAM and has been up 104 days.'

    expect((await propose({ action: 'reboot', guest: '128' }, ctx('reboot it', { snap, answered }))).refused).toBe(
      UNGROUNDED_TARGET_MESSAGE
    )
    expect((await propose({ action: 'reboot', guest: '104' }, ctx('ok do it', { answered }))).refused).toBe(
      UNGROUNDED_TARGET_MESSAGE
    )
    expect((await propose({ action: 'reboot', guest: '128' }, ctx('reboot 128', { snap, answered }))).card?.target.name).toBe('app-128')
  })

  it('still takes a name from an assistant answer the user read, for a safe kind', async () => {
    const res = await propose({ action: 'snapshot', guest: 'win2025' }, ctx('snapshot that one', { answered: 'win2025 uses 90 % CPU.' }))

    expect(res.card?.target.name).toBe('win2025')

    const move = await propose({ action: 'migrate', guest: 'win2025' }, ctx('move that one', { answered: 'win2025 uses 90 % CPU.' }))

    expect(move.card?.target.name).toBe('win2025')
  })

  it.each([
    ['reboot', { guest: 'win2025' }, 'win2025 uses 90 % CPU.'],
    ['shutdown', { guest: 'win2025' }, 'win2025 uses 90 % CPU.'],
    ['maintenance', { host: 'pve2', mode: 'enter' }, 'pve2 has 12 pending updates.'],
    ['migrate', { guest: 'ct-web' }, 'ct-web uses 90 % CPU.'],
  ])('takes the target of a disruptive %s from what the user typed only', async (action, args, answered) => {
    const res = await propose({ action, ...args }, ctx('do it on that one', { answered }))

    expect(res.refused).toBe(UNGROUNDED_TARGET_MESSAGE)
    expect(h.pveFetch).not.toHaveBeenCalled()

    const name = 'guest' in args ? args.guest : args.host
    const typed = await propose({ action, ...args }, ctx(`${action} ${name}`, { answered }))

    expect(typed.card?.target.name).toBe(name)
  })

  it('grounds the host of a pending_updates plan, maintenance steps, on what the user typed', async () => {
    const res = await invokeTool(proposeRemediationPlanTool, { finding: 'pending_updates', host: 'pve2' }, ctx('plan it', { answered: 'pve2 has 12 pending updates.' }))

    expect(res).toMatchObject({ ok: false, message: UNGROUNDED_TARGET_MESSAGE })
  })

  it('refuses a cluster argument the user did not name', async () => {
    const refused = await propose({ action: 'start', guest: 'db-01', cluster: 'PVE-PROD' }, ctx('start db-01'))

    expect(refused.error).toBe('out-of-scope')
    expect(refused.refused).toBe('Name the cluster you want me to act on.')

    const named = await propose({ action: 'start', guest: 'db-01', cluster: 'PVE-PROD' }, ctx('start db-01 on pve-prod'))

    expect(named.card?.target.cluster).toBe('PVE-PROD')

    const planRefused = await invokeTool(proposeRemediationPlanTool, { finding: 'pending_updates', host: 'pve2', cluster: 'PVE-PROD' }, ctx('update pve2'))

    expect(planRefused).toMatchObject({ ok: false, message: 'Name the cluster you want me to act on.' })
  })

  it('accepts the vmid as the name', async () => {
    const res = await propose({ action: 'reboot', guest: '104' }, ctx('reboot 104 please'))

    expect(res.card?.target).toMatchObject({ vmid: 104, name: 'win2025', node: 'pve1', guestKind: 'qemu' })
  })
})

describe('same-named targets (roadmap#188 lab)', () => {
  // The lab: two VMs named w22-i1000, and a pve1 in PVE-DR too.
  const twins = () => snapshot(
    [guest('111', 'w22-i1000', 'qemu', 'running', 'pve3'), guest('115', 'w22-i1000', 'qemu', 'running', 'pve1')],
    [node('c1', 'pve1', 50), node('c1', 'pve2', 20), node('c1', 'pve3', 10), node('c2', 'pve1', 5)]
  )
  const replies = ['w22-i1000 (vmid 111, pve3, PVE-PROD)', 'w22-i1000 (vmid 115, pve1, PVE-PROD)']

  it.each([
    ['the vmid it read in a tool result', '111'],
    ['the shared name', 'w22-i1000'],
  ])('builds no card when the model passes %s: the user picks among the homonyms', async (_label, ref) => {
    const c = ctx('Prends un snapshot de la VM w22-i1000', { snap: twins() })
    const outcome = await invokeTool(proposeActionTool, { action: 'snapshot', guest: ref }, c)

    expect(outcome).toMatchObject({ ok: false, error: 'out-of-scope' })
    expect(outcome.ok === false && outcome.choices?.map(ch => ch.reply)).toEqual(replies)
    // The refusal spends nothing: neither the proposal budget nor a Proxmox call.
    expect(c.usage?.proposals ?? 0).toBe(0)
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('proposes the card once the user typed the vmid, by clicking a choice or by hand', async () => {
    const snap = twins()
    const clicked = ctx(replies[0], { snap, answered: 'Several targets match: pick the one you want.' })

    expect((await propose({ action: 'snapshot', guest: '111' }, clicked)).card?.target).toMatchObject({ vmid: 111, node: 'pve3', name: 'w22-i1000' })
    expect((await propose({ action: 'snapshot', guest: replies[0] }, clicked)).card?.target.vmid).toBe(111)
    expect((await propose({ action: 'snapshot', guest: 'VM 115' }, ctx('snapshot VM 115', { snap }))).card?.target.vmid).toBe(115)
  })

  it('refuses the homonym the user did not type, even next to the vmid they did', async () => {
    const outcome = await invokeTool(proposeActionTool, { action: 'snapshot', guest: '115' }, ctx('snapshot w22-i1000 111', { snap: twins() }))

    expect(outcome.ok === false && outcome.choices).toHaveLength(2)
  })

  it('asks for the cluster of a host two clusters share, a cluster only the assistant named being not enough', async () => {
    const answered = 'pve1 of PVE-DR has 3 pending updates.'
    const refused = await invokeTool(proposeActionTool, { action: 'maintenance', host: 'pve1', cluster: 'PVE-DR', mode: 'enter' }, ctx('maintenance on pve1', { snap: twins(), answered }))

    expect(refused.ok === false && refused.choices).toEqual([
      { kind: 'host', label: 'pve1 · PVE-PROD', reply: 'pve1 (PVE-PROD)' },
      { kind: 'host', label: 'pve1 · PVE-DR', reply: 'pve1 (PVE-DR)' },
    ])

    const named = await propose({ action: 'maintenance', host: 'pve1', cluster: 'PVE-DR', mode: 'enter' }, ctx('pve1 (PVE-DR)', { snap: twins(), answered }))

    expect(named.card?.target).toMatchObject({ connId: 'c2', node: 'pve1' })
  })

  it('asks for the cluster of a plan host two clusters share, and frees the plan slot', async () => {
    const answered = 'pve1 of PVE-DR has 3 pending updates.'
    const c = ctx('update pve1', { snap: twins(), answered })
    const refused = await invokeTool(proposeRemediationPlanTool, { finding: 'pending_updates', host: 'pve1', cluster: 'PVE-DR' }, c)

    expect(refused.ok === false && refused.choices?.map(ch => ch.reply)).toEqual(['pve1 (PVE-PROD)', 'pve1 (PVE-DR)'])
    expect(c.usage?.proposals ?? 0).toBe(0)
    expect(c.usage?.plans ?? 0).toBe(0)

    const named = await invokeTool(proposeRemediationPlanTool, { finding: 'pending_updates', host: 'pve1', cluster: 'PVE-DR' }, ctx('update pve1 (PVE-DR)', { snap: twins(), answered }))

    expect(named.ok).toBe(true)
  })
})

describe('the user\'s own scope (roadmap#188 lab: evacuating pve1)', () => {
  // r9lxc-zfs lives on pve1 (PVE-PROD) and on pve2-dr (PVE-DR); NginX twice in PVE-PROD.
  const estate = () => snapshot(
    [
      guest('9921', 'r9lxc-zfs', 'lxc', 'running', 'pve1'),
      guest('89921', 'r9lxc-zfs', 'lxc', 'stopped', 'pve2-dr', { connId: 'c2', cluster: 'PVE-DR' }),
      guest('104', 'NginX', 'qemu', 'running', 'pve1'),
      guest('113', 'NginX', 'qemu', 'running', 'pve3'),
    ],
    [node('c1', 'pve1', 50), node('c1', 'pve2', 20), node('c1', 'pve3', 10), node('c2', 'pve2-dr', 5)]
  )

  it('grounds every guest of the host the user named, a container migration included', async () => {
    const said = 'move everything still on pve1 to pve3'

    expect((await propose({ action: 'migrate', guest: 'win2025', target_host: 'pve3' }, ctx(said))).card?.target).toMatchObject({ vmid: 104, node: 'pve1' })
    expect((await propose({ action: 'migrate', guest: 'ct-web', target_host: 'pve3' }, ctx(said))).card?.target).toMatchObject({ vmid: 205, node: 'pve1' })
    // db-01 runs on pve2, which the user did not name.
    expect((await propose({ action: 'migrate', guest: 'db-01', target_host: 'pve3' }, ctx(said))).error).toBe('out-of-scope')
  })

  it('never grounds a shutdown or a reboot by its host, and a container migration\'s host only from what the user typed', async () => {
    for (const action of ['reboot', 'shutdown']) {
      expect((await propose({ action, guest: 'win2025' }, ctx('is pve1 healthy?'))).error).toBe('out-of-scope')
    }

    const answered = await propose({ action: 'migrate', guest: 'ct-web', target_host: 'pve3' }, ctx('move them to pve3', { answered: 'pve1 runs ct-web.' }))

    expect(answered.error).toBe('out-of-scope')
  })

  it.each([
    ['the destination', 'migre r9lxc-zfs vers pve3'],
    ['the source host', 'migre r9lxc-zfs de pve1'],
  ])('tells two same-named guests apart by %s the user typed', async (_label, said) => {
    const c = ctx(said, { snap: estate() })
    const res = await propose({ action: 'migrate', guest: 'r9lxc-zfs', target_host: 'pve3' }, c)

    expect(res.card?.target).toMatchObject({ vmid: 9921, connId: 'c1', node: 'pve1' })
  })

  it('leaves out the homonym already on the destination', async () => {
    const res = await propose({ action: 'migrate', guest: 'NginX', target_host: 'pve3' }, ctx('vide pve1 et pve3 vers pve3', { snap: estate() }))

    expect(res.card?.target).toMatchObject({ vmid: 104, node: 'pve1' })
  })

  it('still asks when the user\'s words fit both, or only the assistant named the host', async () => {
    const both = await invokeTool(proposeActionTool, { action: 'snapshot', guest: 'NginX' }, ctx('snapshot NginX on pve1 and pve3', { snap: estate() }))
    const told = await invokeTool(proposeActionTool, { action: 'snapshot', guest: 'NginX' }, ctx('snapshot NginX', { snap: estate(), answered: 'NginX 104 runs on pve1.' }))
    // A destination the user did not type does not pick either.
    const dest = await invokeTool(proposeActionTool, { action: 'migrate', guest: 'r9lxc-zfs', target_host: 'pve3' }, ctx('move r9lxc-zfs', { snap: estate(), answered: 'pve3 is the least loaded.' }))

    for (const outcome of [both, told, dest]) expect(outcome.ok === false && outcome.choices).toHaveLength(2)
  })
})

describe('propose_action', () => {
  it('returns a one-line summary to the model and the signed card beside it', async () => {
    const res = await propose({ action: 'reboot', guest: 'win2025' }, ctx('reboot win2025'))

    // What the model reads is the serialised result: the symbol-keyed cards are not in it.
    expect(JSON.parse(JSON.stringify(res.value))).toEqual({
      status: 'awaiting-approval',
      proposed: "Proposed: reboot win2025 (104) on pve1, waiting for the user's approval",
      checks: [expect.objectContaining({ level: 'ok' })],
    })
    expect(JSON.stringify(res.value)).not.toContain(res.card!.token)
    expect(res.card).toMatchObject({ kind: 'reboot', tier: 'disruptive', params: {} })
    expect(verifyCard(res.card!, bind)).toEqual({ ok: true })
  })

  it.each([
    ['win2025', 'qemu'],
    ['ct-web', 'lxc'],
  ])('blocks start on %s (%s), already running', async name => {
    const res = await propose({ action: 'start', guest: name }, ctx(`start ${name}`))

    expect(res.value?.status).toBe('blocked')
    expect(res.value?.proposed).toContain('blocked:')
    expect(res.card?.preflight.ok).toBe(false)
    expect(res.card?.preflight.checks.some(c => c.level === 'block')).toBe(true)
  })

  it.each([
    ['db-01', 'qemu'],
    ['ct-cache', 'lxc'],
  ])('blocks shutdown and reboot on %s (%s), stopped', async name => {
    for (const action of ['shutdown', 'reboot']) {
      const res = await propose({ action, guest: name }, ctx(`${action} ${name}`))

      expect(res.card?.preflight.ok, action).toBe(false)
    }

    expect((await propose({ action: 'start', guest: name }, ctx(`start ${name}`))).card?.preflight.ok).toBe(true)
  })

  it('names a snapshot by default and refuses an invalid name', async () => {
    const res = await propose({ action: 'snapshot', guest: 'win2025' }, ctx('snapshot win2025'))

    expect(String(res.card?.params.name)).toMatch(/^ai-\d{8}-\d{4}$/)

    const bad = await propose({ action: 'snapshot', guest: 'win2025', snapshot_name: '1; rm -rf' }, ctx('snapshot win2025'))

    expect(bad.error).toBe('bad-argument')
  })

  it('counts at most 3 proposals per question', async () => {
    const c = ctx('reboot win2025')

    for (let i = 0; i < 3; i++) expect((await propose({ action: 'reboot', guest: 'win2025' }, c)).card).toBeDefined()

    const fourth = await propose({ action: 'reboot', guest: 'win2025' }, c)

    expect(fourth.error).toBe('out-of-scope')
    expect(fourth.refused).toContain('3')
  })
})

describe('migrate', () => {
  it('proposes a live move of a VM on shared storage, safe tier', async () => {
    const res = await propose({ action: 'migrate', guest: 'win2025', target_host: 'pve3' }, ctx('move win2025 to pve3'))

    expect(res.card).toMatchObject({ kind: 'migrate', tier: 'safe', params: { target: 'pve3', online: true } })
    expect(res.card?.preflight.ok).toBe(true)
    expect(h.pveFetch).toHaveBeenCalledTimes(1)
  })

  it('marks a container move disruptive: it restarts on the target', async () => {
    const res = await propose({ action: 'migrate', guest: 'ct-web', target_host: 'pve3' }, ctx('move ct-web to pve3'))

    expect(res.card?.tier).toBe('disruptive')
    expect(res.card?.preflight.checks).toContainEqual({ level: 'warn', text: 'The container restarts on the target host.' })
  })

  it.each([
    ['win2025', 'qemu'],
    ['ct-web', 'lxc'],
  ])('refuses a move of %s (%s) to another cluster', async name => {
    const res = await propose({ action: 'migrate', guest: name, target_host: 'pve1-dr' }, ctx(`move ${name} to pve1-dr`))

    expect(res.error).toBe('out-of-scope')
    expect(res.refused).toContain('PVE-DR')
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('blocks a VM with a local disk', async () => {
    h.pveFetch.mockResolvedValueOnce({
      allowed_nodes: [],
      local_disks: [{ drivename: 'scsi0', shared: 0, volid: 'Dir-Images:104/vm-104-disk-0.qcow2' }],
      local_resources: [],
      not_allowed_nodes: { pve3: { unavailable_storages: ['Dir-Images'] } },
      running: 1,
    })

    const res = await propose({ action: 'migrate', guest: 'win2025', target_host: 'pve3' }, ctx('move win2025 to pve3'))

    expect(res.card?.preflight.ok).toBe(false)
    expect(res.card?.preflight.checks.find(c => c.level === 'block')?.text).toContain('Dir-Images')
  })

  it('blocks a container whose storage the target lacks', async () => {
    h.pveFetch.mockResolvedValueOnce({ 'allowed-nodes': ['pve2'], 'not-allowed-nodes': { pve3: { unavailable_storages: ['local-lvm'] } }, running: 1 })

    const res = await propose({ action: 'migrate', guest: 'ct-web', target_host: 'pve3' }, ctx('move ct-web to pve3'))

    expect(res.card?.preflight.ok).toBe(false)
    expect(res.card?.preflight.checks.find(c => c.level === 'block')?.text).toContain('local-lvm')
  })

  it('blocks a container whose rootfs is on a storage defined everywhere but not shared', async () => {
    const fallback = h.pveFetch.getMockImplementation()!

    h.pveFetch.mockImplementation(async (conn: unknown, path: string) =>
      path === '/nodes/pve1/lxc/205/config' ? { rootfs: 'LVM-Thick:vm-205-disk-0,size=8G' } : fallback(conn, path)
    )

    const res = await propose({ action: 'migrate', guest: 'ct-web', target_host: 'pve3' }, ctx('move ct-web to pve3'))

    expect(res.card?.preflight.ok).toBe(false)
    expect(res.card?.preflight.checks.find(c => c.level === 'block')?.text).toContain('LVM-Thick')
  })

  it('blocks a container with a bind mount', async () => {
    const fallback = h.pveFetch.getMockImplementation()!

    h.pveFetch.mockImplementation(async (conn: unknown, path: string) =>
      path === '/nodes/pve1/lxc/205/config' ? { rootfs: 'CephStoragePool:vm-205-disk-0', mp0: '/srv/data,mp=/data' } : fallback(conn, path)
    )

    const res = await propose({ action: 'migrate', guest: 'ct-web', target_host: 'pve3' }, ctx('move ct-web to pve3'))

    expect(res.card?.preflight.checks.find(c => c.level === 'block')?.text).toContain('bind mount')
  })

  it('lets a container on Ceph RBD through with one protected call, the precondition', async () => {
    const res = await propose({ action: 'migrate', guest: 'ct-web', target_host: 'pve3' }, ctx('move ct-web to pve3'))

    expect(res.card?.preflight.ok).toBe(true)
    // Precondition (protected), then the config and the cluster storage
    // config (neither protected); never the per-node storage status.
    expect(h.pveFetch.mock.calls.map(c => c[1])).toEqual(['/nodes/pve1/lxc/205/migrate', '/nodes/pve1/lxc/205/config', '/storage'])
  })

  it('reads the storage config once a minute per connection', async () => {
    const c = ctx('move ct-web to pve3')

    await propose({ action: 'migrate', guest: 'ct-web', target_host: 'pve3' }, c)
    await propose({ action: 'migrate', guest: 'ct-web', target_host: 'pve3' }, c)

    expect(h.pveFetch.mock.calls.filter(call => call[1] === '/storage')).toHaveLength(1)
    expect(h.pveFetch.mock.calls.some(call => /^\/nodes\/[^/]+\/storage/.test(String(call[1])))).toBe(false)
  })

  it('blocks a container on a shared storage not defined for its host', async () => {
    const fallback = h.pveFetch.getMockImplementation()!

    h.pveFetch.mockImplementation(async (conn: unknown, path: string) =>
      path === '/nodes/pve1/lxc/205/config' ? { rootfs: 'nfs-pve2:205/vm-205-disk-0.raw' } : fallback(conn, path)
    )

    const res = await propose({ action: 'migrate', guest: 'ct-web', target_host: 'pve3' }, ctx('move ct-web to pve3'))

    expect(res.card?.preflight.checks.find(c => c.level === 'block')?.text).toContain('nfs-pve2')
  })

  it('blocks a stopped guest without calling Proxmox', async () => {
    const res = await propose({ action: 'migrate', guest: 'db-01', target_host: 'pve3' }, ctx('move db-01 to pve3'))

    expect(res.card?.preflight.ok).toBe(false)
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('picks the host itself when the model names one the user did not', async () => {
    const res = await propose({ action: 'migrate', guest: 'win2025', target_host: 'pve2' }, ctx('move win2025 off its host'))

    // pve3 has the most free RAM; pve2 came from the model alone.
    expect(res.card?.params.target).toBe('pve3')
  })
})

describe('drs_apply', () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    id: 'r1', connection_id: 'c1', vmid: 104, vm_name: 'win2025', source_node: 'pve1', target_node: 'pve3', status: 'pending', reason: 'RAM', ...over,
  })

  it('proposes a pending recommendation whose guest and hosts are visible', async () => {
    h.client.getRecommendations.mockResolvedValue({ data: [rec()] })

    const res = await propose({ action: 'drs_apply', guest: 'win2025' }, ctx('apply the DRS move of win2025'))

    expect(res.card).toMatchObject({ kind: 'drs_apply', params: { recommendationId: 'r1' }, target: { vmid: 104 } })
    expect(res.card?.preflight.ok).toBe(true)
  })

  it('refuses a recommendation naming a host out of scope', async () => {
    h.client.getRecommendations.mockResolvedValue({ data: [rec({ target_node: 'pve9' })] })

    const res = await propose({ action: 'drs_apply', recommendation: 'r1' }, ctx('apply the DRS move of win2025'))

    expect(res.error).toBe('out-of-scope')
  })
})

describe('backup_add', () => {
  it('adds the guest to the named or first compatible job', async () => {
    h.pveFetch.mockImplementation(async (_c: unknown, path: string) =>
      path === '/cluster/backup' ? [{ id: 'pool-job', pool: 'gold' }, { id: 'nightly', vmid: '101,102' }] : []
    )

    const res = await propose({ action: 'backup_add', guest: 'win2025' }, ctx('back up win2025'))

    expect(res.card).toMatchObject({ kind: 'backup_add', params: { jobId: 'nightly' } })
    expect(res.card?.preflight.ok).toBe(true)
  })

  it('takes the job only when the conversation named it, else the first compatible one', async () => {
    h.pveFetch.mockImplementation(async (_c: unknown, path: string) =>
      path === '/cluster/backup' ? [{ id: 'weekly', vmid: '101' }, { id: 'nightly', vmid: '101,102' }] : []
    )

    // The model alone picked nightly: ignored, like a target_host the user never named.
    const ungrounded = await propose({ action: 'backup_add', guest: 'win2025', job: 'nightly' }, ctx('back up win2025'))

    expect(ungrounded.card?.params).toEqual({ jobId: 'weekly' })

    const named = await propose({ action: 'backup_add', guest: 'win2025', job: 'nightly' }, ctx('add win2025 to the nightly job'))

    expect(named.card?.params).toEqual({ jobId: 'nightly' })

    const unknown = await propose({ action: 'backup_add', guest: 'win2025', job: 'hourly' }, ctx('add win2025 to the hourly job'))

    expect(unknown.error).toBe('out-of-scope')
  })

  it('is refused to a vDC tenant', async () => {
    h.vdcPools = new Set(['gold'])

    const res = await propose({ action: 'backup_add', guest: 'win2025' }, ctx('back up win2025'))

    expect(res.error).toBe('out-of-scope')
  })
})

describe('maintenance', () => {
  it('refuses a viewer without node.manage', async () => {
    h.denied.add('node.manage|c1:pve2')

    const res = await propose({ action: 'maintenance', host: 'pve2', mode: 'enter' }, ctx('put pve2 in maintenance'))

    expect(res.error).toBe('out-of-scope')
    expect(res.refused).toContain('pve2')
  })

  it('proposes enter on a host in service, and blocks exit while not in maintenance', async () => {
    const enter = await propose({ action: 'maintenance', host: 'pve2', mode: 'enter' }, ctx('put pve2 in maintenance'))

    expect(enter.card).toMatchObject({ kind: 'maintenance', tier: 'disruptive', params: { mode: 'enter' }, target: { node: 'pve2', name: 'pve2' } })
    expect(enter.card?.target.vmid).toBeUndefined()
    expect(enter.card?.preflight.ok).toBe(true)

    const exit = await propose({ action: 'maintenance', host: 'pve2', mode: 'exit' }, ctx('take pve2 out of maintenance'))

    expect(exit.card?.preflight.ok).toBe(false)
  })
})

describe('propose_remediation_plan', () => {
  async function plan(args: Record<string, unknown>, c: ToolContext) {
    const outcome = await invokeTool(proposeRemediationPlanTool, args, c)

    if (outcome.ok !== true) return { refused: outcome.message, error: outcome.error }

    return { value: outcome.value as Record<string, any>, plan: cardsOf(outcome.value).plans[0] }
  }

  const many = () => Array.from({ length: 65 }, (_, i) => guest(String(1000 + i), `app-${i}`, i % 2 ? 'lxc' : 'qemu', 'running', 'pve2'))
  const nightlyOnly = async (_c: unknown, path: string) => (path === '/cluster/backup' ? [{ id: 'nightly', vmid: '104,205,101,206,300,301' }] : [])
  const capped = (maxPerConversation: number) =>
    normalizeAiActionsSettings({ enabled: true, actions: Object.fromEntries(ACTION_KINDS.map(k => [k, true])), maxPerConversation })

  it('never plans more card steps than the conversation may execute', async () => {
    const fallback = h.pveFetch.getMockImplementation()!

    h.pveFetch.mockImplementation(async (conn: unknown, path: string) => (path === '/cluster/backup' ? nightlyOnly(conn, path) : fallback(conn, path)))

    // The default cap: 5 actions per conversation, so 5 steps, the rest said.
    const res = await plan({ finding: 'unprotected_guests' }, ctx('protect the unprotected guests', { snap: snapshot(many()) }))

    expect(res.plan?.steps).toHaveLength(5)
    expect(res.value?.proposed).toContain('5-step plan')
    expect(res.value?.proposed).toContain('60 more left for a later conversation')

    const two = await plan({ finding: 'pending_updates', host: 'pve2' }, ctx('pve2 has pending updates, plan it', { settings: capped(1) }))

    expect(two.plan?.steps.map(s => s.card?.params.mode ?? 'manual')).toEqual(['enter', 'manual'])
    expect(two.value?.proposed).toContain('1 more left for a later conversation')

    const big = [
      guest('400', 'big-1', 'qemu', 'running', 'pve1', { memUsedGb: 12, memTotalGb: 16 }),
      guest('401', 'big-2', 'qemu', 'running', 'pve1', { memUsedGb: 10, memTotalGb: 12 }),
    ]
    // pve1 at 62 of 64 GB: moving big-1 still leaves it above 75 %, the cap stops the plan there.
    const nodes = [node('c1', 'pve1', 62), node('c1', 'pve2', 20), node('c1', 'pve3', 10), node('c2', 'pve1-dr', 5)]
    const relief = await plan({ finding: 'host_memory', host: 'pve1' }, ctx('pve1 is short of RAM', { snap: snapshot(big, nodes), settings: capped(1) }))

    expect(relief.plan?.steps).toHaveLength(1)
    expect(relief.value?.proposed).toContain('more moves left for a later conversation')
  })

  it('signs every plan step for 2 hours, a loose card for 15 minutes', async () => {
    h.pveFetch.mockImplementation(nightlyOnly)

    const before = Date.now()
    const res = await plan({ finding: 'unprotected_guests' }, ctx('protect the unprotected guests', { snap: snapshot(many()) }))
    const loose = await propose({ action: 'snapshot', guest: 'win2025' }, ctx('snapshot win2025'))
    const after = Date.now()

    for (const s of res.plan!.steps) {
      expect(s.card!.expiresAt).toBeGreaterThanOrEqual(before + 2 * 60 * 60 * 1000)
      expect(s.card!.expiresAt).toBeLessThanOrEqual(after + 2 * 60 * 60 * 1000)
    }
    expect(loose.card!.expiresAt).toBeGreaterThanOrEqual(before + 15 * 60 * 1000)
    expect(loose.card!.expiresAt).toBeLessThanOrEqual(after + 15 * 60 * 1000)
  })

  it('turns 65 unprotected guests into 10 signed steps when the cap allows it', async () => {
    h.pveFetch.mockImplementation(nightlyOnly)

    const res = await plan({ finding: 'unprotected_guests' }, ctx('protect the unprotected guests', { snap: snapshot(many()), settings: capped(20) }))

    expect(res.plan?.steps).toHaveLength(10)
    expect(res.plan?.finding).toBe('unprotected_guests')

    res.plan!.steps.forEach((s, i) => {
      expect(s.step).toBe(i + 1)
      expect(s.card).toMatchObject({ kind: 'backup_add', planId: res.plan!.planId, step: i + 1, params: { jobId: 'nightly' } })
      expect(verifyCard(s.card!, bind)).toEqual({ ok: true })
      // R12: each step names the card step it waits for, the first none.
      expect(s.card!.after).toBe(i === 0 ? undefined : i)
    })
    expect(res.value?.status).toBe('awaiting-approval')
    expect(res.value?.proposed).toContain('10')
    expect(JSON.stringify(res.value)).not.toContain(res.plan!.steps[0].card!.token)
  })

  it('plans pending updates as enter, a manual Rolling Update step, then exit', async () => {
    const res = await plan({ finding: 'pending_updates', host: 'pve2' }, ctx('pve2 has pending updates, plan it'))
    const steps = res.plan!.steps

    expect(steps.map(s => s.card?.params.mode ?? 'manual')).toEqual(['enter', 'manual', 'exit'])
    expect(steps[1].card).toBeUndefined()
    expect(steps[1].manual?.href).toBe('/infrastructure/inventory?selectType=cluster&selectId=c1')
    // The exit step runs after the enter step: it is not blocked by today's state.
    expect(steps[2].card?.preflight.ok).toBe(true)
    // R12: exit waits for the enter card, the manual step in between is skipped.
    expect(steps[0].card?.after).toBeUndefined()
    expect(steps[2].card?.after).toBe(1)
    expect(verifyCard(steps[2].card!, bind)).toEqual({ ok: true })
    expect(verifyCard({ ...steps[2].card!, after: undefined }, bind)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('plans only the exit of a host already in maintenance, waiting on no step', async () => {
    const nodes = [node('c1', 'pve1', 50), node('c1', 'pve2', 20, { maintenance: 'maintenance' }), node('c1', 'pve3', 10)]
    const res = await plan({ finding: 'pending_updates', host: 'pve2' }, ctx('pve2 has pending updates, plan it', { snap: snapshot([], nodes) }))
    const steps = res.plan!.steps

    expect(steps.map(s => s.card?.params.mode ?? 'manual')).toEqual(['manual', 'exit'])
    expect(steps[1].card?.after).toBeUndefined()
  })

  it('grounds the host of the finding', async () => {
    const res = await plan({ finding: 'pending_updates', host: 'pve2' }, ctx('which host needs updates?'))

    expect(res.refused).toBe(UNGROUNDED_TARGET_MESSAGE)
  })

  it('relieves a host short of RAM by moving its biggest guests, each checked with Proxmox', async () => {
    const big = [
      guest('400', 'big-1', 'qemu', 'running', 'pve1', { memUsedGb: 12, memTotalGb: 16 }),
      guest('401', 'big-2', 'qemu', 'running', 'pve1', { memUsedGb: 10, memTotalGb: 12 }),
    ]

    const res = await plan({ finding: 'host_memory', host: 'pve1' }, ctx('pve1 is short of RAM', { snap: snapshot(big) }))
    const steps = res.plan!.steps

    expect(steps.length).toBeGreaterThan(0)
    expect(steps[0].card).toMatchObject({ kind: 'migrate', target: { name: 'big-1', node: 'pve1' } })
    expect(steps.every(s => s.card?.params.target !== 'pve1')).toBe(true)
    expect(steps[0].card?.preflight.ok).toBe(true)
    expect(steps.map(s => s.card?.after)).toEqual(steps.map((_, i) => (i === 0 ? undefined : i)))
    expect(h.pveFetch.mock.calls.filter(c => String(c[1]).endsWith('/migrate'))).toHaveLength(steps.length)
  })

  it('drops a candidate on local storage from a host_memory plan, and says so', async () => {
    const big = [
      guest('400', 'big-1', 'qemu', 'running', 'pve1', { memUsedGb: 12, memTotalGb: 16 }),
      guest('401', 'big-2', 'qemu', 'running', 'pve1', { memUsedGb: 10, memTotalGb: 12 }),
    ]
    const fallback = h.pveFetch.getMockImplementation()!

    h.pveFetch.mockImplementation(async (conn: unknown, path: string) => (path === '/nodes/pve1/qemu/400/migrate' ? localDisk : fallback(conn, path)))

    const res = await plan({ finding: 'host_memory', host: 'pve1' }, ctx('pve1 is short of RAM', { snap: snapshot(big) }))

    expect(res.plan!.steps.map(s => s.card?.target.name)).toEqual(['big-2'])
    expect(res.value?.proposed).toContain('1 guest skipped: local storage')
    expect(res.value?.checks).toContainEqual(expect.objectContaining({ level: 'warn', text: expect.stringContaining('Skipped big-1') }))
  })

  it('checks at most 5 candidates of a host_memory plan with Proxmox, one at a time', async () => {
    const eight = Array.from({ length: 8 }, (_, i) => guest(String(500 + i), `local-${i}`, 'qemu', 'running', 'pve1', { memUsedGb: 3, memTotalGb: 4 }))
    let inFlight = 0
    let maxInFlight = 0

    h.pveFetch.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight--

      return localDisk
    })

    const res = await plan({ finding: 'host_memory', host: 'pve1' }, ctx('pve1 is short of RAM', { snap: snapshot(eight) }))

    expect(h.pveFetch).toHaveBeenCalledTimes(5)
    expect(maxInFlight).toBe(1)
    expect(res.value?.status).toBe('nothing-to-do')
    expect(res.value?.proposed).toContain('5 guests skipped: local storage')
  })

  it('counts as one proposal', async () => {
    const c = ctx('pve2 has pending updates, reboot win2025')

    await plan({ finding: 'pending_updates', host: 'pve2' }, c)
    expect(c.usage?.proposals).toBe(1)
  })

  it('proposes one plan per question, a second one refused', async () => {
    const c = ctx('pve2 and pve3 have pending updates, plan them')

    expect((await plan({ finding: 'pending_updates', host: 'pve2' }, c)).plan).toBeDefined()

    const second = await plan({ finding: 'pending_updates', host: 'pve3' }, c)

    expect(second.error).toBe('out-of-scope')
    expect(second.refused).toContain('One remediation plan per question')
  })

  it('refuses the second of two plans asked in the same round', async () => {
    const c = ctx('pve2 and pve3 have pending updates, plan them')
    const both = await Promise.all([plan({ finding: 'pending_updates', host: 'pve2' }, c), plan({ finding: 'pending_updates', host: 'pve3' }, c)])

    expect(both.filter(r => r.plan)).toHaveLength(1)
    expect(both.filter(r => r.refused?.includes('One remediation plan per question'))).toHaveLength(1)
  })

  it('lets a plan refused on its arguments be asked again', async () => {
    const c = ctx('pve2 has pending updates, plan it')

    expect((await plan({ finding: 'pending_updates' }, c)).error).toBe('bad-argument')
    expect((await plan({ finding: 'pending_updates', host: 'pve2' }, c)).plan).toBeDefined()
  })
})

describe('Proxmox load of the proposals', () => {
  it('keeps one Proxmox read in flight per question, three migrations proposed in one round', async () => {
    const fallback = h.pveFetch.getMockImplementation()!
    let inFlight = 0
    let maxInFlight = 0

    h.pveFetch.mockImplementation(async (conn: unknown, path: string) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 2))
      inFlight--

      return fallback(conn, path)
    })

    const c = ctx('move win2025, ct-web and evil-vm to pve3')
    const res = await Promise.all(
      ['win2025', 'ct-web', 'evil-vm'].map(g => propose({ action: 'migrate', guest: g, target_host: 'pve3' }, c))
    )

    expect(res.map(r => r.card?.preflight.ok)).toEqual([true, true, true])
    // Two precondition GETs, plus the container's precondition, config and storage config.
    expect(h.pveFetch).toHaveBeenCalledTimes(5)
    expect(maxInFlight).toBe(1)
  })

  it('does not hold a read behind one that failed', async () => {
    const fallback = h.pveFetch.getMockImplementation()!

    h.pveFetch.mockImplementation(async (conn: unknown, path: string) => {
      if (path === '/nodes/pve1/qemu/104/migrate') throw new Error('pvedaemon busy')

      return fallback(conn, path)
    })

    const c = ctx('move win2025 and evil-vm to pve3')
    const [failed, passed] = await Promise.all([
      propose({ action: 'migrate', guest: 'win2025', target_host: 'pve3' }, c),
      propose({ action: 'migrate', guest: 'evil-vm', target_host: 'pve3' }, c),
    ])

    expect(failed.card?.preflight.ok).toBe(false)
    expect(passed.card?.preflight.ok).toBe(true)
  })
})

describe('shared with execute', () => {
  it('re-resolves a card target by connection and vmid, without the actions context', async () => {
    const c = ctx('')

    delete c.actions

    const target = resolveActionTarget({ kind: 'start', guest: '101', connId: 'c1' }, c)

    expect(target).toMatchObject({ connId: 'c1', vmid: 101, node: 'pve2', name: 'db-01' })

    const preflight = await preflightAction({ kind: 'start', target, params: {} }, c)

    expect(preflight.ok).toBe(true)
  })
})
