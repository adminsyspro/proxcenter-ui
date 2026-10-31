// roadmap#184: DRS affinity rules stay on the clusters the tenant owns. A vDC
// binding lends a slice of a provider cluster, and a rule names guests and
// nodes of the whole cluster.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null as any),
  requireProviderTenant: vi.fn(async () => null as any),
  owned: new Set<string>(['own-1']),
  client: {
    getRules: vi.fn(),
    createRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
    enforceRule: vi.fn(),
  },
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: h.checkPermission,
  PERMISSIONS: { AUTOMATION_VIEW: 'automation.view', AUTOMATION_MANAGE: 'automation.manage', AUTOMATION_EXECUTE: 'automation.execute' },
}))
vi.mock('@/lib/tenant', () => ({ requireProviderTenant: h.requireProviderTenant }))
vi.mock('@/lib/orchestrator/drsRuleScope', () => ({
  drsConnectionIds: async () => h.owned,
  isTenantRuleConnection: async (id: unknown) => typeof id === 'string' && h.owned.has(id),
  mayActOnDrsRule: async (client: any, id: string) => {
    const rule = ((await client.getRules()).data ?? []).find((r: any) => r.id === id)
    return !rule || (rule.connection_id ? h.owned.has(rule.connection_id) : false)
  },
}))
vi.mock('@/lib/orchestrator/client', () => ({ getOrchestratorClient: () => h.client }))
vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_opts: unknown, handler: unknown) => handler }))

import { GET, POST } from './route'
import { PUT, DELETE } from './[id]/route'
import { POST as ENFORCE } from './[id]/enforce/route'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const RULES = [
  { id: 'r-own', connection_id: 'own-1' },
  { id: 'r-provider', connection_id: 'prod' },
  { id: 'r-none', connection_id: '' },
]

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.requireProviderTenant.mockReset().mockResolvedValue(new Response(null, { status: 403 }))
  for (const fn of Object.values(h.client)) fn.mockReset().mockResolvedValue({ data: {} })
  h.client.getRules.mockResolvedValue({ data: RULES })
})

describe('DRS rules tenancy', () => {
  it('lists the rules of the owned clusters, not the provider ones nor the connection-less ones', async () => {
    const res = await callRoute(GET as any)

    expect((await readJson<any[]>(res))!.map(r => r.id)).toEqual(['r-own'])
  })

  it('shows the provider tenant the connection-less rules to clean up', async () => {
    h.requireProviderTenant.mockResolvedValue(null)

    const res = await callRoute(GET as any)

    expect((await readJson<any[]>(res))!.map(r => r.id)).toEqual(['r-own', 'r-none'])
  })

  it('refuses a rule without a connection', async () => {
    const res = await callRoute(POST as any, { method: 'POST', body: { name: 'x', type: 'affinity', vmids: [1] } })

    expect(res.status).toBe(400)
    expect(h.client.createRule).not.toHaveBeenCalled()
  })

  it('refuses a rule on a cluster the tenant does not own', async () => {
    const res = await callRoute(POST as any, { method: 'POST', body: { name: 'x', type: 'affinity', connectionId: 'prod', vmids: [1] } })

    expect(res.status).toBe(404)
    expect(h.client.createRule).not.toHaveBeenCalled()
  })

  it('creates a rule on an owned cluster, under a fresh id whatever the body says', async () => {
    const res = await callRoute(POST as any, { method: 'POST', body: { id: 'r-provider', name: 'x', type: 'affinity', connectionId: 'own-1', vmids: [1] } })

    expect(res.status).toBe(200)
    const created = h.client.createRule.mock.calls[0][0]
    expect(created).toMatchObject({ connection_id: 'own-1' })
    expect(created.id).not.toBe('r-provider')
  })

  it('refuses to move an owned rule onto a provider cluster', async () => {
    const res = await callRoute(PUT as any, { method: 'PUT', params: { id: 'r-own' }, body: { connectionId: 'prod' } })

    expect(res.status).toBe(404)
    expect(h.client.updateRule).not.toHaveBeenCalled()
  })

  it('edits an owned rule in place', async () => {
    const res = await callRoute(PUT as any, { method: 'PUT', params: { id: 'r-own' }, body: { name: 'renamed' } })

    expect(res.status).toBe(200)
    expect(h.client.updateRule).toHaveBeenCalledWith('r-own', { name: 'renamed' })
  })

  it.each([
    ['PUT', () => callRoute(PUT as any, { method: 'PUT', params: { id: 'r-provider' }, body: { name: 'x' } })],
    ['DELETE', () => callRoute(DELETE as any, { method: 'DELETE', params: { id: 'r-none' } })],
    ['enforce', () => callRoute(ENFORCE as any, { method: 'POST', params: { id: 'r-provider' } })],
  ])('%s on a rule the tenant may not act on reads as missing', async (_label, call) => {
    const res = await call()

    expect(res.status).toBe(404)
    expect(h.client.updateRule).not.toHaveBeenCalled()
    expect(h.client.deleteRule).not.toHaveBeenCalled()
    expect(h.client.enforceRule).not.toHaveBeenCalled()
  })
})
