import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock } = vi.hoisted(() => ({ checkPermissionMock: vi.fn() }))
const licence = vi.hoisted(() => ({ features: new Set<string>(['ai_insights', 'ai_actions']) }))
const store = vi.hoisted(() => ({ rows: new Map<string, unknown>() }))

vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireFeature: async (f: string) =>
    licence.features.has(f) ? null : new Response(JSON.stringify({ error: 'Feature not licensed' }), { status: 403 }),
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/db/settings', () => ({
  getSetting: async (k: string, t: string) => store.rows.get(`${k}:${t}`) ?? null,
  setSetting: async (k: string, t: string, v: unknown) => { store.rows.set(`${k}:${t}`, v) },
}))
vi.mock('@/lib/audit', () => ({ audit: vi.fn(async () => 'audit-id') }))

import { GET, PUT } from './route'

beforeEach(() => {
  licence.features = new Set(['ai_insights', 'ai_actions'])
  store.rows.clear()
  checkPermissionMock.mockReset()
  checkPermissionMock.mockResolvedValue(null)
})

describe('/api/v1/settings/ai-actions', () => {
  it('403 without the ai_actions feature', async () => {
    licence.features = new Set(['ai_insights'])
    expect((await callRoute(GET)).status).toBe(403)
    expect((await callRoute(PUT, { method: 'PUT', body: { enabled: true } })).status).toBe(403)
  })

  it('403 without the ai_insights feature', async () => {
    licence.features = new Set(['ai_actions'])
    expect((await callRoute(GET)).status).toBe(403)
  })

  it('403 for a non admin', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))
    expect((await callRoute(GET)).status).toBe(403)
    expect((await callRoute(PUT, { method: 'PUT', body: { enabled: true } })).status).toBe(403)
    expect(store.rows.size).toBe(0)
  })

  it('GET returns defaults when nothing is stored', async () => {
    const body = (await readJson(await callRoute(GET))) as any
    expect(body.data.enabled).toBe(false)
    expect(body.data.maxPerConversation).toBe(5)
  })

  it('PUT normalises then GET round-trips', async () => {
    const put = await callRoute(PUT, {
      method: 'PUT',
      body: { enabled: true, maxPerConversation: 99, actions: { snapshot: true, nope: true } },
    })
    expect(put.status).toBe(200)
    const body = (await readJson(await callRoute(GET))) as any
    expect(body.data.enabled).toBe(true)
    expect(body.data.maxPerConversation).toBe(20)
    expect(body.data.actions.snapshot).toBe(true)
    expect(body.data.actions.nope).toBeUndefined()
  })

  it('PUT rejects a non-object payload', async () => {
    expect((await callRoute(PUT, { method: 'PUT', body: [1] })).status).toBe(400)
  })
})
