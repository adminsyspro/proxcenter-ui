import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ checkPermission: vi.fn(), tenant: { id: 'acme' }, listMoves: vi.fn() }))

// API token guard: pass-through, these tests drive the session path (token
// paths: routeGuard.test.ts, tenancyTokenScope.test.ts).
vi.mock("@/lib/api-tokens/routeGuard", () => ({ withPublicApiGuard: (_entryId: string, handler: any) => handler }))
vi.mock('@/lib/rbac', () => ({ checkPermission: (...a: any[]) => h.checkPermission(...a), PERMISSIONS: { VM_VIEW: 'vm.view' } }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => h.tenant.id }))
vi.mock('@/lib/vdc/move/status', () => ({ listMoves: h.listMoves }))

import { GET as LIST } from './route'
import { GET as ONE } from './[moveId]/route'

beforeEach(() => {
  vi.clearAllMocks()
  h.tenant.id = 'acme'
  h.checkPermission.mockResolvedValue(null)
  h.listMoves.mockResolvedValue([{ id: 'm1' }])
})

describe('GET /api/v1/vdc/moves', () => {
  it('lists the tenant moves, active only on demand', async () => {
    const res = await LIST(new Request('http://x/api/v1/vdc/moves?active=1'))
    expect(res.status).toBe(200)
    expect(h.listMoves).toHaveBeenCalledWith({ tenantId: 'acme', isProvider: false, activeOnly: true })
  })

  it('lists every move for the provider', async () => {
    h.tenant.id = 'default'
    await LIST(new Request('http://x/api/v1/vdc/moves'))
    expect(h.listMoves).toHaveBeenCalledWith({ tenantId: 'default', isProvider: true, activeOnly: false })
  })

  it('needs vm.view', async () => {
    h.checkPermission.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await LIST(new Request('http://x'))).status).toBe(403)
  })
})

describe('GET /api/v1/vdc/moves/{moveId}', () => {
  const ctx = (moveId: string) => ({ params: Promise.resolve({ moveId }) })

  it('answers one move of the tenant', async () => {
    const res = await ONE(new Request('http://x'), ctx('m1'))
    expect(res.status).toBe(200)
    expect(h.listMoves).toHaveBeenCalledWith({ tenantId: 'acme', isProvider: false, moveId: 'm1', limit: 1 })
  })

  it('answers 404 for a move of another tenant and 400 for a bad id', async () => {
    h.listMoves.mockResolvedValue([])
    expect((await ONE(new Request('http://x'), ctx('m2'))).status).toBe(404)
    expect((await ONE(new Request('http://x'), ctx('../etc'))).status).toBe(400)
  })
})
