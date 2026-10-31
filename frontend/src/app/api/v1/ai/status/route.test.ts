import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const h = vi.hoisted(() => ({
  denied: false,
  licensed: true,
  settings: null as Record<string, unknown> | null,
  checkPermission: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
  checkPermission: (...a: unknown[]) => h.checkPermission(...a),
}))
vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireFeature: async () => (h.licensed ? null : new Response(JSON.stringify({ error: 'Feature not licensed' }), { status: 403 })),
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/db/settings', () => ({ getSetting: async () => h.settings }))

import { GET } from './route'

const get = async () => callRoute(GET as any, { method: 'GET' })

beforeEach(() => {
  h.denied = false
  h.licensed = true
  h.settings = null
  h.checkPermission.mockReset().mockImplementation(async () => (h.denied ? new Response('{}', { status: 403 }) : null))
})

describe('GET /api/v1/ai/status', () => {
  it('tells any user who may chat whether the assistant is on and which model answers, never a key or a URL', async () => {
    h.settings = { enabled: true, provider: 'openai', openaiModel: 'gpt-4.1-nano', openaiKey: 'sk-secret', ollamaUrl: 'http://10.0.0.5:11434' }

    const res = await get()

    expect(res.status).toBe(200)
    expect(h.checkPermission).toHaveBeenCalledWith('connection.view')

    const body = await readJson<any>(res)

    expect(body).toEqual({ data: { enabled: true, provider: 'openai', model: 'gpt-4.1-nano' } })
    expect(JSON.stringify(body)).not.toMatch(/sk-secret|10\.0\.0\.5/)
  })

  it('reports the assistant off when nothing is configured', async () => {
    expect((await readJson<any>(await get())).data).toEqual({ enabled: false, provider: 'ollama', model: null })
  })

  it('refuses without the permission or without the Enterprise licence', async () => {
    h.denied = true
    expect((await get()).status).toBe(403)

    h.denied = false
    h.licensed = false
    expect((await get()).status).toBe(403)
  })
})
