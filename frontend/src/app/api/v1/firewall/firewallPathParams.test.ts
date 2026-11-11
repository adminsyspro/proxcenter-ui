import { beforeEach, describe, expect, it, vi } from 'vitest'

// Every /api/v1/firewall/** route that places a request value in an
// orchestrator or PVE API path answers 400 on a value outside its grammar,
// before either backend is called. The grammar itself is covered by
// lib/firewall/pathParams.test.ts; this file pins down that each route asks.

vi.mock('@/lib/tenant/iaasGuard', () => ({
  denyIaasTenant: async () => null,
  resolveCallerInfraScope: async () => ({ ok: true, tenantId: 'default', infra: { kind: 'provider' } }),
}))

vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (_opts: unknown, handler: any) => handler,
}))

const pve = vi.hoisted(() => {
  const calls = { count: 0 }
  // Every export of lib/firewall/pveDirect, each counted as a PVE call.
  const names = [
    'getAliases',
    'createAlias',
    'updateAlias',
    'deleteAlias',
    'getIPSets',
    'createIPSet',
    'updateIPSetComment',
    'deleteIPSet',
    'addIPSetEntry',
    'deleteIPSetEntry',
    'getSecurityGroups',
    'createSecurityGroup',
    'deleteSecurityGroup',
    'addSecurityGroupRule',
    'updateSecurityGroupRule',
    'deleteSecurityGroupRule',
    'getClusterRules',
    'addClusterRule',
    'updateClusterRule',
    'deleteClusterRule',
    'getClusterOptions',
    'updateClusterOptions',
    'getNodeOptions',
    'updateNodeOptions',
    'getNodeRules',
    'addNodeRule',
    'updateNodeRule',
    'deleteNodeRule',
    'getVMOptions',
    'updateVMOptions',
    'getVMRules',
    'addVMRule',
    'updateVMRule',
    'deleteVMRule',
    'getVMFirewallLog',
    'getFirewallLogPage',
    'toggleVMNICFirewall',
    'getFirewallStatus',
  ]
  const stubs: Record<string, () => Promise<void>> = {}

  for (const name of names) stubs[name] = async () => { calls.count++ }

  return { calls, module: stubs }
})

vi.mock('@/lib/firewall/pveDirect', () => pve.module)
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: async () => { pve.calls.count++ } }))

import { handlersOf, installFirewallRouteMocks, orchestrator, resetFirewallRouteMocks } from '@/__tests__/setup/firewall-route-mocks'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

installFirewallRouteMocks()

beforeEach(() => {
  resetFirewallRouteMocks()
  pve.calls.count = 0
})

const C = 'conn-1'
const TRAVERSALS = ['..', '..\\..\\..\\notifications\\settings?', 'x/../y', '%2e%2e', 'a?b=1', 'a#b']

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'
type Case = { route: string; load: () => Promise<unknown>; methods: Method[]; good: Record<string, string>; bad: string; error: string }

const CASES: Case[] = [
  { route: 'nodes/[node]', load: () => import('./nodes/[connectionId]/[node]/route'), methods: ['GET', 'PUT', 'POST'], good: { connectionId: C, node: 'pve1' }, bad: 'node', error: 'Invalid node name' },
  { route: 'nodes/[node]/rules', load: () => import('./nodes/[connectionId]/[node]/rules/route'), methods: ['POST'], good: { connectionId: C, node: 'pve1' }, bad: 'node', error: 'Invalid node name' },
  { route: 'nodes/[node]/rules/[pos] (node)', load: () => import('./nodes/[connectionId]/[node]/rules/[pos]/route'), methods: ['PUT', 'DELETE'], good: { connectionId: C, node: 'pve1', pos: '0' }, bad: 'node', error: 'Invalid node name' },
  { route: 'nodes/[node]/rules/[pos] (pos)', load: () => import('./nodes/[connectionId]/[node]/rules/[pos]/route'), methods: ['PUT', 'DELETE'], good: { connectionId: C, node: 'pve1', pos: '0' }, bad: 'pos', error: 'Invalid rule position' },
  { route: 'cluster/rules/[pos]', load: () => import('./cluster/[connectionId]/rules/[pos]/route'), methods: ['PUT', 'DELETE'], good: { connectionId: C, pos: '0' }, bad: 'pos', error: 'Invalid rule position' },
  { route: 'groups/[groupName]', load: () => import('./groups/[connectionId]/[groupName]/route'), methods: ['DELETE'], good: { connectionId: C, groupName: 'sg-web' }, bad: 'groupName', error: 'Invalid security group name' },
  { route: 'groups/[groupName]/rules', load: () => import('./groups/[connectionId]/[groupName]/rules/route'), methods: ['POST'], good: { connectionId: C, groupName: 'sg-web' }, bad: 'groupName', error: 'Invalid security group name' },
  { route: 'groups/[groupName]/rules/[pos] (group)', load: () => import('./groups/[connectionId]/[groupName]/rules/[pos]/route'), methods: ['PUT', 'DELETE'], good: { connectionId: C, groupName: 'sg-web', pos: '0' }, bad: 'groupName', error: 'Invalid security group name' },
  { route: 'groups/[groupName]/rules/[pos] (pos)', load: () => import('./groups/[connectionId]/[groupName]/rules/[pos]/route'), methods: ['PUT', 'DELETE'], good: { connectionId: C, groupName: 'sg-web', pos: '0' }, bad: 'pos', error: 'Invalid rule position' },
  { route: 'aliases/[name]', load: () => import('./aliases/[connectionId]/[name]/route'), methods: ['PUT', 'DELETE'], good: { connectionId: C, name: 'web-servers' }, bad: 'name', error: 'Invalid alias name' },
  { route: 'ipsets/[ipsetName]', load: () => import('./ipsets/[connectionId]/[ipsetName]/route'), methods: ['PUT', 'DELETE'], good: { connectionId: C, ipsetName: 'blacklist' }, bad: 'ipsetName', error: 'Invalid IP set name' },
  { route: 'ipsets/[ipsetName]/entries', load: () => import('./ipsets/[connectionId]/[ipsetName]/entries/route'), methods: ['POST'], good: { connectionId: C, ipsetName: 'blacklist' }, bad: 'ipsetName', error: 'Invalid IP set name' },
  { route: 'ipsets/[ipsetName]/entries/[cidr] (ipset)', load: () => import('./ipsets/[connectionId]/[ipsetName]/entries/[cidr]/route'), methods: ['DELETE'], good: { connectionId: C, ipsetName: 'blacklist', cidr: '10.0.0.0/8' }, bad: 'ipsetName', error: 'Invalid IP set name' },
  { route: 'vms/.../rules/[pos]', load: () => import('./vms/[connectionId]/[node]/[vmType]/[vmid]/rules/[pos]/route'), methods: ['PUT', 'DELETE'], good: { connectionId: C, node: 'pve1', vmType: 'qemu', vmid: '100', pos: '0' }, bad: 'pos', error: 'Invalid rule position' },
]

describe('malformed path parameters', () => {
  for (const c of CASES) {
    for (const method of c.methods) {
      it(`${method} ${c.route}: 400 before the orchestrator or PVE`, async () => {
        const handlers = handlersOf(await c.load())

        for (const value of TRAVERSALS) {
          const res = await callRoute(handlers[method], { params: { ...c.good, [c.bad]: value }, method, body: method === 'GET' || method === 'DELETE' ? undefined : {} })

          expect(res.status, JSON.stringify(value)).toBe(400)
          expect(await readJson<any>(res)).toEqual({ error: c.error })
        }
        for (const verb of Object.values(orchestrator)) expect(verb).not.toHaveBeenCalled()
        expect(pve.calls.count).toBe(0)
      })

      it(`${method} ${c.route}: a well-formed value still reaches the orchestrator`, async () => {
        const handlers = handlersOf(await c.load())

        for (const verb of Object.values(orchestrator)) verb.mockResolvedValue({ data: {}, status: 200 })
        const res = await callRoute(handlers[method], { params: c.good, method, body: method === 'GET' || method === 'DELETE' ? undefined : {} })

        expect(res.status).toBeLessThan(300)
      })
    }
  }

  it('DELETE ipsets/[ipsetName]/entries/[cidr]: 400 on an address outside the grammar', async () => {
    const { DELETE } = handlersOf(await import('./ipsets/[connectionId]/[ipsetName]/entries/[cidr]/route'))

    for (const cidr of ['..', '../x', '10.0.0.0\\8', '10.0.0.0?x', '10.0.0.0/..']) {
      const res = await callRoute(DELETE, { params: { connectionId: C, ipsetName: 'blacklist', cidr }, method: 'DELETE' })

      expect(res.status, cidr).toBe(400)
      expect(await readJson<any>(res)).toEqual({ error: 'Invalid address' })
    }
    expect(orchestrator.delete).not.toHaveBeenCalled()
    expect(pve.calls.count).toBe(0)
  })

  it('DELETE ipsets/[ipsetName]/entries/[cidr]: sends an IPv6 address as is and a CIDR with its slash encoded', async () => {
    const { DELETE } = handlersOf(await import('./ipsets/[connectionId]/[ipsetName]/entries/[cidr]/route'))

    orchestrator.delete.mockResolvedValue({ data: {}, status: 200 })
    await callRoute(DELETE, { params: { connectionId: C, ipsetName: 'blacklist', cidr: 'fd00::1' }, method: 'DELETE' })
    expect(orchestrator.delete).toHaveBeenLastCalledWith('/firewall/ipsets/conn-1/blacklist/entries/fd00::1', { encodedSlash: true })
    await callRoute(DELETE, { params: { connectionId: C, ipsetName: 'blacklist', cidr: '10.0.0.0/8' }, method: 'DELETE' })
    expect(orchestrator.delete).toHaveBeenLastCalledWith('/firewall/ipsets/conn-1/blacklist/entries/10.0.0.0%2F8', { encodedSlash: true })
  })
})

describe('the ?type= selector', () => {
  const ROUTES: Array<{ route: string; load: () => Promise<unknown>; params: Record<string, string>; base: string }> = [
    { route: 'cluster', load: () => import('./cluster/[connectionId]/route'), params: { connectionId: C }, base: '/firewall/cluster/conn-1' },
    { route: 'nodes/[node]', load: () => import('./nodes/[connectionId]/[node]/route'), params: { connectionId: C, node: 'pve1' }, base: '/firewall/nodes/conn-1/pve1' },
    { route: 'vms/[node]/[vmType]/[vmid]', load: () => import('./vms/[connectionId]/[node]/[vmType]/[vmid]/route'), params: { connectionId: C, node: 'pve1', vmType: 'qemu', vmid: '100' }, base: '/firewall/vms/conn-1/pve1/qemu/100' },
  ]

  for (const r of ROUTES) {
    it(`GET ${r.route}: options by default, rules on request`, async () => {
      const { GET } = handlersOf(await r.load())

      orchestrator.get.mockResolvedValue({ data: {}, status: 200 })
      await callRoute(GET, { params: r.params })
      expect(orchestrator.get).toHaveBeenLastCalledWith(`${r.base}/options`)
      await callRoute(GET, { params: r.params, searchParams: { type: 'options' } })
      expect(orchestrator.get).toHaveBeenLastCalledWith(`${r.base}/options`)
      await callRoute(GET, { params: r.params, searchParams: { type: 'rules' } })
      expect(orchestrator.get).toHaveBeenLastCalledWith(`${r.base}/rules`)
    })

    it(`GET ${r.route}: 400 on any other type, before the orchestrator or PVE`, async () => {
      const { GET } = handlersOf(await r.load())

      for (const type of ['..\\..\\..\\notifications\\settings?', '%2e%2e/%2e%2e/notifications/settings?', 'rules?x=1', 'log', 'Rules']) {
        const res = await callRoute(GET, { params: r.params, searchParams: { type } })

        expect(res.status, type).toBe(400)
        expect(await readJson<any>(res)).toEqual({ error: 'Invalid type' })
      }
      expect(orchestrator.get).not.toHaveBeenCalled()
      expect(pve.calls.count).toBe(0)
    })
  }
})

describe('query values sent to the orchestrator', () => {
  it('GET microseg/analyze: the gateway offset stays one query value', async () => {
    const { GET } = handlersOf(await import('./microseg/[connectionId]/analyze/route'))

    orchestrator.get.mockResolvedValue({ data: {}, status: 200 })
    const { NextRequest } = await import('next/server')

    await (GET as any)(new NextRequest('http://test.local/_?gateway_offset=1%26dry_run%3Dfalse'), { params: Promise.resolve({ connectionId: C }) })
    expect(orchestrator.get).toHaveBeenLastCalledWith('/firewall/microseg/conn-1/analyze?gateway_offset=1%26dry_run%3Dfalse')
    await (GET as any)(new NextRequest('http://test.local/_'), { params: Promise.resolve({ connectionId: C }) })
    expect(orchestrator.get).toHaveBeenLastCalledWith('/firewall/microseg/conn-1/analyze?gateway_offset=254')
  })

  it('GET microseg/vms: the network filter stays one query value', async () => {
    const { GET } = handlersOf(await import('./microseg/[connectionId]/vms/route'))

    orchestrator.get.mockResolvedValue({ data: {}, status: 200 })
    const { NextRequest } = await import('next/server')

    await (GET as any)(new NextRequest('http://test.local/_?network=10.0.0.0%2F24'), { params: Promise.resolve({ connectionId: C }) })
    expect(orchestrator.get).toHaveBeenLastCalledWith('/firewall/microseg/conn-1/vms?network=10.0.0.0%2F24')
    await (GET as any)(new NextRequest('http://test.local/_'), { params: Promise.resolve({ connectionId: C }) })
    expect(orchestrator.get).toHaveBeenLastCalledWith('/firewall/microseg/conn-1/vms')
  })
})
