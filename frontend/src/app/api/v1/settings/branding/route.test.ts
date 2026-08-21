import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null as any),
  getCurrentTenantId: vi.fn(async () => 'default'),
  getSetting: vi.fn(async () => null as any),
  setSetting: vi.fn(async (_key: string, _tenantId: string, _value: unknown) => {}),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: h.checkPermission, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: h.getCurrentTenantId }))
vi.mock('@/lib/db/settings', () => ({ getSetting: h.getSetting, setSetting: h.setSetting }))

import { GET, PUT } from './route'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.getCurrentTenantId.mockReset().mockResolvedValue('default')
  h.getSetting.mockReset().mockResolvedValue(null)
  h.setSetting.mockReset().mockResolvedValue(undefined)
})

const storedPrimaryColor = () => (h.setSetting.mock.calls[0]?.[2] as any).primaryColor

describe('PUT /settings/branding primary colour (#754)', () => {
  it('adds the missing hash instead of storing a value MUI cannot parse', async () => {
    const res = await callRoute(PUT, { method: 'PUT', body: { enabled: true, primaryColor: '00ECB2' } })

    expect(res.status).toBe(200)
    expect(storedPrimaryColor()).toBe('#00ECB2')
    expect(await readJson<any>(res)).toMatchObject({ success: true, primaryColor: '#00ECB2' })
  })

  it('keeps a well-formed colour untouched', async () => {
    await callRoute(PUT, { method: 'PUT', body: { enabled: true, primaryColor: '#00ECB2' } })

    expect(storedPrimaryColor()).toBe('#00ECB2')
  })

  it('rejects a colour that cannot be repaired, storing nothing', async () => {
    const res = await callRoute(PUT, { method: 'PUT', body: { enabled: true, primaryColor: 'turquoise' } })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/primaryColor/)
    expect(h.setSetting).not.toHaveBeenCalled()
  })

  it.each(['#ZZZZZZ', '#00-CB2', '#00EC', '#00ECB'])('rejects %s', async value => {
    const res = await callRoute(PUT, { method: 'PUT', body: { enabled: true, primaryColor: value } })

    expect(res.status).toBe(400)
    expect(h.setSetting).not.toHaveBeenCalled()
  })

  it('treats an empty colour as "no override" and still saves the rest', async () => {
    const res = await callRoute(PUT, { method: 'PUT', body: { enabled: true, appName: 'Almond', primaryColor: '' } })

    expect(res.status).toBe(200)
    expect(storedPrimaryColor()).toBe('')
    expect((h.setSetting.mock.calls[0][2] as any).appName).toBe('Almond')
  })

  it('drops a non-string colour rather than passing it through to the palette', async () => {
    const res = await callRoute(PUT, { method: 'PUT', body: { enabled: true, primaryColor: { hex: '#00ECB2' } } })

    expect(res.status).toBe(400)
    expect(h.setSetting).not.toHaveBeenCalled()
  })

  it('denies without the admin settings permission', async () => {
    h.checkPermission.mockResolvedValue(new Response('no', { status: 403 }) as any)

    const res = await callRoute(PUT, { method: 'PUT', body: { primaryColor: '#00ECB2' } })

    expect(res.status).toBe(403)
    expect(h.setSetting).not.toHaveBeenCalled()
  })
})

describe('GET /settings/branding primary colour (#754)', () => {
  it('repairs a colour stored before the value was validated', async () => {
    h.getSetting.mockResolvedValue({ enabled: true, primaryColor: '00ECB2' })

    const res = await callRoute(GET, { method: 'GET' })

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).primaryColor).toBe('#00ECB2')
  })

  it('drops an unrepairable stored colour so the form does not offer it back', async () => {
    h.getSetting.mockResolvedValue({ enabled: true, primaryColor: 'turquoise' })

    const res = await callRoute(GET, { method: 'GET' })

    expect((await readJson<any>(res)).primaryColor).toBe('')
  })

  it('leaves an unset colour empty', async () => {
    h.getSetting.mockResolvedValue({ enabled: true })

    const res = await callRoute(GET, { method: 'GET' })

    expect((await readJson<any>(res)).primaryColor).toBe('')
  })
})
