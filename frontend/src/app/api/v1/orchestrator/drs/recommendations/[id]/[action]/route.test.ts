/**
 * A refused execution used to come back as a bare 500 whatever the reason,
 * and the DRS page then showed nothing at all (roadmap#71). The orchestrator's
 * 4xx answers now keep their status and their reason.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  checkPermission: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => h.checkPermission(...a),
  PERMISSIONS: { VM_MIGRATE: 'vm.migrate', AUTOMATION_MANAGE: 'automation.manage' },
}))
vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: async () => new Set(['c1']),
}))
vi.mock('@/lib/orchestrator/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator/client')>()

  return {
    ...actual,
    getOrchestratorClient: () => ({
      getRecommendations: async () => ({ data: [{ id: 'rec-1', connection_id: 'c1' }] }),
      getActiveMigrations: async () => ({ data: [] }),
      get: async () => ({ data: { max_concurrent_migrations: 2 } }),
      executeRecommendation: (...a: any[]) => h.execute(...a),
    }),
  }
})

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  h.checkPermission.mockResolvedValue(null)
})

describe('POST /api/v1/orchestrator/drs/recommendations/[id]/execute', () => {
  it('passes a refusal through with its status and reason', async () => {
    h.execute.mockRejectedValue(new Error('Orchestrator 409: {"error":"migration of VM 9771 to pve2 refused: a rolling update is in progress on this cluster"}'))

    const res = await callRoute(POST as any, { params: { id: 'rec-1', action: 'execute' }, method: 'POST' })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'migration of VM 9771 to pve2 refused: a rolling update is in progress on this cluster' })
  })

  it('keeps a missing recommendation a 404 the page recognises', async () => {
    h.execute.mockRejectedValue(new Error('Orchestrator 404: {"error":"Recommendation not found"}'))

    const res = await callRoute(POST as any, { params: { id: 'rec-1', action: 'execute' }, method: 'POST' })

    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('not found')
  })

  it('still answers 500 on an unexpected failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.execute.mockRejectedValue(new Error('socket hang up'))

    const res = await callRoute(POST as any, { params: { id: 'rec-1', action: 'execute' }, method: 'POST' })

    expect(res.status).toBe(500)
  })

  it('returns the orchestrator answer when the migration starts', async () => {
    h.execute.mockResolvedValue({ data: { id: 'mig-1' } })

    const res = await callRoute(POST as any, { params: { id: 'rec-1', action: 'execute' }, method: 'POST' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'mig-1' })
  })
})
