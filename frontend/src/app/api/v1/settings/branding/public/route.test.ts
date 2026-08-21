import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getCurrentTenantId: vi.fn(async () => 'default'),
  getSetting: vi.fn(async () => null as any),
}))

vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: h.getCurrentTenantId }))
vi.mock('@/lib/db/settings', () => ({ getSetting: h.getSetting }))

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
