/**
 * The basemap settings route (issue #960). Its two asymmetries are the whole
 * point: any signed-in user may READ it, because every map on the page needs
 * the tile URL, while writing it takes admin.settings; and a custom template
 * that cannot draw tiles is refused rather than stored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

vi.mock('@/lib/db/settings', () => ({
  getSetting: vi.fn<(...args: any[]) => Promise<any>>(),
  setSetting: vi.fn<(...args: any[]) => Promise<void>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: vi.fn<() => Promise<string>>() }))

import { GET, PUT } from './route'
import { getServerSession } from 'next-auth'
import { getSetting, setSetting } from '@/lib/db/settings'
import { checkPermission } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'

const sessionMock = getServerSession as any
const getSettingMock = getSetting as any
const setSettingMock = setSetting as any
const checkPermissionMock = checkPermission as any
const tenantMock = getCurrentTenantId as any

const OSM = { provider: 'osm', lightUrl: '', darkUrl: '', attribution: '' }

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { id: 'u1' } })
  getSettingMock.mockResolvedValue(null)
  setSettingMock.mockResolvedValue(undefined)
  checkPermissionMock.mockResolvedValue(null)
  tenantMock.mockResolvedValue('default')
})

describe('GET /api/v1/settings/map', () => {
  it('refuses an anonymous caller', async () => {
    sessionMock.mockResolvedValue(null)

    const res = await callRoute(GET as any)

    expect(res.status).toBe(401)
  })

  it('answers the keyless default when nothing was ever saved', async () => {
    const res = await callRoute(GET as any)

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: OSM, canEdit: true })
  })

  it('lets a user without admin.settings read it, flagged read-only', async () => {
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))

    const res = await callRoute(GET as any)

    expect(res.status).toBe(200)
    expect((await readJson(res)) as any).toMatchObject({ canEdit: false })
  })

  it('normalises a stored row rather than trusting it', async () => {
    getSettingMock.mockResolvedValue({ provider: 'carto', lightUrl: '  https://t.lan/{z}/{x}/{y}.png ' })

    const res = await callRoute(GET as any)

    expect((await readJson(res)) as any).toMatchObject({
      data: { provider: 'osm', lightUrl: 'https://t.lan/{z}/{x}/{y}.png' },
    })
  })

  it('answers 500 when the store breaks', async () => {
    getSettingMock.mockRejectedValue(new Error('db down'))

    const res = await callRoute(GET as any)

    expect(res.status).toBe(500)
  })
})

describe('PUT /api/v1/settings/map', () => {
  it('hands back the RBAC refusal untouched', async () => {
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))

    const res = await callRoute(PUT as any, { method: 'PUT', body: OSM })

    expect(res.status).toBe(403)
    expect(setSettingMock).not.toHaveBeenCalled()
  })

  it('rejects a body that is not an object', async () => {
    const res = await callRoute(PUT as any, { method: 'PUT', body: ['osm'] })

    expect(res.status).toBe(400)
  })

  it('rejects a custom source whose light template cannot draw tiles', async () => {
    const res = await callRoute(PUT as any, {
      method: 'PUT',
      body: { provider: 'custom', lightUrl: 'https://tiles.lan/preview.png' },
    })

    expect(res.status).toBe(400)
    expect(setSettingMock).not.toHaveBeenCalled()
  })

  it('rejects a broken dark template even when the light one is fine', async () => {
    const res = await callRoute(PUT as any, {
      method: 'PUT',
      body: {
        provider: 'custom',
        lightUrl: 'https://tiles.lan/{z}/{x}/{y}.png',
        darkUrl: 'https://tiles.lan/dark.png',
      },
    })

    expect(res.status).toBe(400)
    expect(setSettingMock).not.toHaveBeenCalled()
  })

  it('stores a complete custom source under the tenant', async () => {
    const res = await callRoute(PUT as any, {
      method: 'PUT',
      body: {
        provider: 'custom',
        lightUrl: 'https://tiles.lan/{z}/{x}/{y}.png',
        darkUrl: 'https://tiles.lan/dark/{z}/{x}/{y}.png',
        attribution: 'Internal tiles',
      },
    })

    expect(res.status).toBe(200)
    expect(setSettingMock).toHaveBeenCalledWith('map', 'default', {
      provider: 'custom',
      lightUrl: 'https://tiles.lan/{z}/{x}/{y}.png',
      darkUrl: 'https://tiles.lan/dark/{z}/{x}/{y}.png',
      attribution: 'Internal tiles',
    })
  })

  it('stores the OSM default without asking for a template', async () => {
    const res = await callRoute(PUT as any, { method: 'PUT', body: { provider: 'osm' } })

    expect(res.status).toBe(200)
    expect(setSettingMock).toHaveBeenCalledWith('map', 'default', OSM)
  })

  it('answers 500 when the store breaks', async () => {
    setSettingMock.mockRejectedValue(new Error('db down'))

    const res = await callRoute(PUT as any, { method: 'PUT', body: { provider: 'osm' } })

    expect(res.status).toBe(500)
  })
})
