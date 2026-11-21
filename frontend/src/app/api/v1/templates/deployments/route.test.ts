import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({ findMany: vi.fn<(...a: any[]) => Promise<any[]>>() }))
vi.mock('@/lib/tenant', () => ({ getSessionPrisma: async () => ({ deployment: { findMany: m.findMany } }) }))
vi.mock('@/lib/rbac', () => ({ checkPermission: async () => null, PERMISSIONS: { VM_VIEW: 'vm.view' } }))

import { GET } from './route'

beforeEach(() => m.findMany.mockReset())

describe('GET /api/v1/templates/deployments (roadmap#265)', () => {
  it('lists deployments saved before with a cloud-init password without it', async () => {
    m.findMany.mockResolvedValue([{ id: 'dep-1', config: { downloadStorage: 'local', cloudInit: { ciuser: 'ops', cipassword: 's3cret' } } }, { id: 'dep-2', config: null }])
    const json = await readJson<any>(await callRoute(GET as any, { method: 'GET' }))
    expect(json.data[0].config).toEqual({ downloadStorage: 'local', cloudInit: { ciuser: 'ops' } })
    expect(json.data[1].config).toBeNull()
  })
})
