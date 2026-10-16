/**
 * GET /api/v1/admin/vdc-usage-history/deleted (#902): provider only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { permMock, providerMock, listMock } = vi.hoisted(() => ({ permMock: vi.fn(), providerMock: vi.fn(), listMock: vi.fn() }))

vi.mock('@/lib/rbac', () => ({ checkPermission: () => permMock(), PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant', () => ({ requireProviderTenant: () => providerMock() }))
vi.mock('@/lib/vdc/usageHistory/deleted', () => ({ listDeletedVdcHistories: (...a: any[]) => listMock(...a) }))

import { GET } from './route'

beforeEach(() => {
  providerMock.mockReset().mockResolvedValue(null)
  permMock.mockReset().mockResolvedValue(null)
  listMock.mockReset().mockResolvedValue([{ vdcId: 'gone', vdcName: 'Gone' }])
})

describe('GET /api/v1/admin/vdc-usage-history/deleted', () => {
  it('lists every deleted vDC with samples left', async () => {
    const res = await GET()

    expect(await res.json()).toEqual({ data: [{ vdcId: 'gone', vdcName: 'Gone' }] })
    expect(listMock).toHaveBeenCalledWith()
  })

  it('is refused outside the provider tenant and without the permission', async () => {
    providerMock.mockResolvedValueOnce(new Response('no', { status: 403 }))
    expect((await GET()).status).toBe(403)
    permMock.mockResolvedValueOnce(new Response('no', { status: 403 }))
    expect((await GET()).status).toBe(403)
    expect(listMock).not.toHaveBeenCalled()
  })

  it('answers 500 on an error', async () => {
    listMock.mockRejectedValueOnce(new Error('db down'))
    expect((await GET()).status).toBe(500)
  })
})
