import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const h = vi.hoisted(() => ({
  denied: false,
  licensed: true,
  settings: null as Record<string, unknown> | null,
  actionsLicensed: true,
  actions: null as Record<string, unknown> | null,
  actionsError: null as Error | null,
  actionsLicenceError: null as Error | null,
  checkPermission: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
  checkPermission: (...a: unknown[]) => h.checkPermission(...a),
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireFeature: async () => (h.licensed ? null : new Response(JSON.stringify({ error: 'Feature not licensed' }), { status: 403 })),
  hasServerFeature: async () => {
    if (h.actionsLicenceError) throw h.actionsLicenceError

    return h.actionsLicensed
  },
}))
vi.mock('@/lib/db/settings', () => ({
  getSetting: async (key: string) => {
    if (key === 'ai_actions' && h.actionsError) throw h.actionsError

    return key === 'ai_actions' ? h.actions : h.settings
  },
}))

import { GET } from './route'

const get = async () => callRoute(GET as any, { method: 'GET' })

beforeEach(() => {
  h.denied = false
  h.licensed = true
  h.settings = null
  h.actionsLicensed = true
  h.actions = null
  h.actionsError = null
  h.actionsLicenceError = null
  h.checkPermission.mockReset().mockImplementation(async () => (h.denied ? new Response('{}', { status: 403 }) : null))
})

describe('GET /api/v1/ai/status', () => {
  it('tells any user who may chat whether the assistant is on and which model answers, never a key or a URL', async () => {
    h.settings = { enabled: true, provider: 'openai', openaiModel: 'gpt-4.1-nano', openaiKey: 'sk-secret', ollamaUrl: 'http://10.0.0.5:11434' }

    const res = await get()

    expect(res.status).toBe(200)
    expect(h.checkPermission).toHaveBeenCalledWith('connection.view')

    const body = await readJson<any>(res)

    expect(body).toEqual({ data: { enabled: true, provider: 'openai', model: 'gpt-4.1-nano', actionsEnabled: false } })
    expect(JSON.stringify(body)).not.toMatch(/sk-secret|10\.0\.0\.5/)
  })

  it('reports the assistant off when nothing is configured', async () => {
    expect((await readJson<any>(await get())).data).toEqual({ enabled: false, provider: 'ollama', model: null, actionsEnabled: false })
  })

  it('refuses without the permission or without the Enterprise licence', async () => {
    h.denied = true
    expect((await get()).status).toBe(403)

    h.denied = false
    h.licensed = false
    expect((await get()).status).toBe(403)
  })

  it('tells the widget the actions are on only when licensed, switched on and at least one kind is allowed', async () => {
    h.settings = { enabled: true }
    h.actions = { enabled: true, actions: { snapshot: true }, maxPerConversation: 5 }
    expect((await readJson<any>(await get())).data.actionsEnabled).toBe(true)

    h.actionsLicensed = false
    expect((await readJson<any>(await get())).data.actionsEnabled).toBe(false)

    h.actionsLicensed = true
    h.actions = { enabled: false, actions: { snapshot: true } }
    expect((await readJson<any>(await get())).data.actionsEnabled).toBe(false)

    h.actions = { enabled: true, actions: {} }
    expect((await readJson<any>(await get())).data.actionsEnabled).toBe(false)
  })

  it('keeps the assistant on, actions off, when the actions settings cannot be read', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    h.settings = { enabled: true, provider: 'ollama', ollamaModel: 'qwen3:8b' }
    h.actionsError = new Error('settings table locked')

    const res = await get()

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data).toEqual({ enabled: true, provider: 'ollama', model: 'qwen3:8b', actionsEnabled: false })
    expect(logged).toHaveBeenCalled()

    h.actionsError = null
    h.actionsLicenceError = new Error('licence service down')
    expect((await readJson<any>(await get())).data).toMatchObject({ enabled: true, actionsEnabled: false })

    logged.mockRestore()
  })

  it('exposes nothing else of the actions settings', async () => {
    h.actions = { enabled: true, actions: { snapshot: true, reboot: true }, maxPerConversation: 9 }
    expect(Object.keys((await readJson<any>(await get())).data).sort()).toEqual(['actionsEnabled', 'enabled', 'model', 'provider'])
  })
})
