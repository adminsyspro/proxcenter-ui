import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ setting: vi.fn(), asset: vi.fn(), tenant: vi.fn() }))

vi.mock('@/lib/db/settings', () => ({ getSettingWithSource: (...a: unknown[]) => m.setting(...a) }))
vi.mock('@/lib/branding/assetStore', () => ({
  getAsset: (...a: unknown[]) => m.asset(...a),
  slotFromFilename: (name: string) => `slot:${name}`,
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: () => m.tenant() }))

import { resolveReportBranding } from './reportBranding'

beforeEach(() => {
  vi.clearAllMocks()
  m.tenant.mockResolvedValue('default')
  m.asset.mockResolvedValue(null)
})

describe('resolveReportBranding', () => {
  it('honours an enabled branding: colour, name and stored logo', async () => {
    m.setting.mockResolvedValue({ tenantId: 'default', value: { enabled: true, primaryColor: '#123456', appName: 'Acme', logoUrl: '/api/branding/../logo.png?v=2' } })
    m.asset.mockResolvedValue({ contentType: 'image/png', data: Buffer.from('png') })
    const b = await resolveReportBranding()
    expect(b).toEqual({ brandColor: '#123456', appName: 'Acme', logoDataUri: `data:image/png;base64,${Buffer.from('png').toString('base64')}` })
    expect(m.asset).toHaveBeenCalledWith('default', 'branding', 'slot:logo.png')
  })

  it('keeps the ProxCenter defaults when branding is off, with the bundled logo', async () => {
    m.setting.mockResolvedValue({ tenantId: 'default', value: { enabled: false, primaryColor: '#123456', appName: 'Acme' } })
    const b = await resolveReportBranding()
    expect(b.brandColor).toBe('#E57000')
    expect(b.appName).toBe('')
    expect(b.logoDataUri.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('never fails the report on a settings error', async () => {
    m.setting.mockRejectedValue(new Error('db down'))
    expect(await resolveReportBranding()).toEqual({ brandColor: '#E57000', logoDataUri: '', appName: '' })
  })
})
