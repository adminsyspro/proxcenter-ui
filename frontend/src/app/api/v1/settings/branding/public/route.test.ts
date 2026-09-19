import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getCurrentTenantId: vi.fn(async () => 'default'),
  getSetting: vi.fn(async (_key?: string, _tenantId?: string) => null as any),
}))

vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: h.getCurrentTenantId }))
vi.mock('@/lib/db/settings', () => ({
  getSettingWithSource: async (key: string, tenantId: string) => {
    const value = await h.getSetting(key, tenantId)
    return value === null ? null : { value, tenantId }
  },
}))

import { GET } from './route'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

beforeEach(() => {
  h.getCurrentTenantId.mockReset().mockResolvedValue('default')
  h.getSetting.mockReset().mockResolvedValue(null)
})

const primaryColorOf = async () => (await readJson<any>(await callRoute(GET, { method: 'GET' }))).primaryColor

// This payload is what the browser feeds to the MUI palette, so a value MUI
// cannot parse used to reach lighten()/darken() and 500 every page (#754).
describe('GET /settings/branding/public primary colour (#754)', () => {
  it('repairs a colour that was stored without its hash', async () => {
    h.getSetting.mockResolvedValue({ enabled: true, primaryColor: '00ECB2' })

    expect(await primaryColorOf()).toBe('#00ECB2')
  })

  it('passes a well-formed colour through', async () => {
    h.getSetting.mockResolvedValue({ enabled: true, primaryColor: '#00ECB2' })

    expect(await primaryColorOf()).toBe('#00ECB2')
  })

  it.each(['turquoise', '#ZZZZZZ', '#00EC', '#00-CB2', 42, null])(
    'never hands %s to the browser',
    async value => {
      h.getSetting.mockResolvedValue({ enabled: true, primaryColor: value })

      expect(await primaryColorOf()).toBe('')
    }
  )

  it('keeps the empty default when branding is disabled', async () => {
    h.getSetting.mockResolvedValue({ enabled: false, primaryColor: '00ECB2' })

    expect(await primaryColorOf()).toBe('')
  })
})


describe('tenant-specific branding image URLs', () => {
  it('changes local image URLs when the active tenant changes, keeping upload revision', async () => {
    h.getSetting.mockResolvedValue({ enabled: true, logoUrl: '/uploads/branding/logo.png?t=12', faviconUrl: 'https://cdn.example/favicon.png' })
    h.getCurrentTenantId.mockResolvedValue('tenant-a')
    const first = await readJson<any>(await callRoute(GET))
    h.getCurrentTenantId.mockResolvedValue('tenant-b')
    const second = await readJson<any>(await callRoute(GET))
    expect(first.logoUrl).not.toBe(second.logoUrl)
    expect(first.logoUrl).toContain('/api/v1/settings/branding/uploads/logo.png?')
    expect(new URL(first.logoUrl, 'http://localhost').searchParams.get('t')).toBe('12')
    expect(first.faviconUrl).toBe('https://cdn.example/favicon.png')
  })

  it('keeps branding settings out of shared caches', async () => {
    const response = await callRoute(GET)
    expect(response.headers.get('Cache-Control')).toMatch(/private.*no-store/)
    expect(response.headers.get('Vary')).toMatch(/Cookie/i)
  })
})
