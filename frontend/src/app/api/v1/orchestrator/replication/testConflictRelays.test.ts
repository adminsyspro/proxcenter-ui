import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ action: vi.fn(), permission: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ checkPermission: mocks.permission, PERMISSIONS: { AUTOMATION_MANAGE: 'automation.manage' } }))
vi.mock('@/lib/tenant', () => ({ getTenantConnectionIds: async () => new Set(['src', 'dst']) }))
vi.mock('@/lib/orchestrator/planTenantScope', () => ({ checkPlanTenantScope: async () => ({ denied: null }) }))
vi.mock('@/lib/orchestrator/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator/client')>()
  return { ...actual, getOrchestratorClient: () => ({
    executeFailover: mocks.action, startDRVM: mocks.action, stopDRVM: mocks.action,
    syncReplicationJob: mocks.action, resumeReplicationJob: mocks.action,
    getReplicationJob: async () => ({ data: { source_cluster: 'src', target_cluster: 'dst' } }),
  }) }
})

import { POST as failover } from './plans/[id]/failover/route'
import { POST as start } from './emergency/start-vm/route'
import { POST as stop } from './emergency/stop-vm/route'
import { POST as sync } from './jobs/[id]/sync/route'
import { POST as resume } from './jobs/[id]/resume/route'

beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue(null) })

describe.each([['failover', failover], ['start', start], ['stop', stop], ['sync', sync], ['resume', resume]] as const)('%s active-test conflict', (_name, route) => {
  it('preserves the 409 and cleanup instruction', async () => {
    mocks.action.mockRejectedValue(new Error('Orchestrator 409: {"error":"test failover active on plan X, run cleanup first"}'))
    const response = await route(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify({ target_cluster: 'dst', resume_replication: true }) }), { params: Promise.resolve({ id: 'job' }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'test failover active on plan X, run cleanup first' })
  })
})
