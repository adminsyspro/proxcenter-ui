import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn()
const getCurrentTenantIdMock = vi.fn(() => 'tenant-1')
const getSettingMock = vi.fn()
const setSettingMock = vi.fn()

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: () => getCurrentTenantIdMock(),
}))
vi.mock('@/lib/db/settings', () => ({
  getSetting: (...a: any[]) => getSettingMock(...a),
  setSetting: (...a: any[]) => setSettingMock(...a),
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getSettingMock.mockResolvedValue(null)
})

describe('GET /api/v1/settings/green', () => {
  it('returns default settings including south_korea CO2 factor', async () => {
    const res = await callRoute(GET as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.co2Factors.south_korea).toBe(0.415)
    expect(body.data.co2Factors.france).toBe(0.052)
    expect(body.data.currency).toBe('EUR')
  })

  it('merges saved settings over defaults', async () => {
    getSettingMock.mockResolvedValue({ currency: 'KRW', co2Country: 'south_korea' })
    const res = await callRoute(GET as any)
    const body = await res.json()
    expect(body.data.currency).toBe('KRW')
    expect(body.data.co2Country).toBe('south_korea')
    expect(body.data.co2Factors.south_korea).toBe(0.415)
  })
})
