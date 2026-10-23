import { NextResponse } from 'next/server'

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

import { haOperation, haOperationWithBody, haWriteGuard } from './haRoute'

const requireFeature = vi.fn()
const requireProviderAdmin = vi.fn()

vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireFeature: (...args: unknown[]) => requireFeature(...args),
}))

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

// Provider tenant + admin.settings in one guard: HA is platform-wide.
vi.mock('@/lib/tenant/providerGuard', () => ({
  requireProviderAdmin: (...args: unknown[]) => requireProviderAdmin(...args),
}))

vi.mock('./headers', () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => ({ 'X-API-Key': 'test', ...extra }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  requireFeature.mockResolvedValue(null)
  requireProviderAdmin.mockResolvedValue(null)
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
})

describe('haWriteGuard', () => {
  it('lets a licensed admin through', async () => {
    await expect(haWriteGuard()).resolves.toBeNull()
    expect(requireFeature).toHaveBeenCalledWith('control_plane_ha')
    expect(requireProviderAdmin).toHaveBeenCalledWith('admin.settings')
  })

  it('returns the licence rejection without asking for the permission', async () => {
    const rejection = NextResponse.json({ error: 'Feature not licensed' }, { status: 403 })
    requireFeature.mockResolvedValue(rejection)

    await expect(haWriteGuard()).resolves.toBe(rejection)
    expect(requireProviderAdmin).not.toHaveBeenCalled()
  })

  it('returns the provider guard rejection (customer tenant admin, or missing permission)', async () => {
    const rejection = NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    requireProviderAdmin.mockResolvedValue(rejection)

    await expect(haWriteGuard()).resolves.toBe(rejection)
  })
})

describe('haOperation', () => {
  it('proxies the call once the guards pass', async () => {
    const res = await haOperation('/ha/pause', 'POST')()

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/ha/pause',
      expect.objectContaining({ method: 'POST', body: undefined })
    )
  })

  it('stops at a failed guard without reaching the orchestrator', async () => {
    requireProviderAdmin.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))

    const res = await haOperation('/ha/pause', 'POST')()

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('haOperationWithBody', () => {
  it('forwards the parsed body upstream', async () => {
    const res = await callRoute(haOperationWithBody('/ha/switchover', 'POST'), {
      body: { candidate: 'proxcenter-2' },
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/ha/switchover',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ candidate: 'proxcenter-2' }) })
    )
  })

  it('answers 400 on an unreadable body instead of blaming the orchestrator', async () => {
    const res = await callRoute(haOperationWithBody('/ha/switchover', 'POST'), {
      method: 'POST',
      body: 'not json at all',
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid JSON body' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops at a failed guard without reading the body', async () => {
    requireFeature.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))

    const res = await callRoute(haOperationWithBody('/ha/sync-mode', 'PUT'), {
      method: 'PUT',
      body: { mode: 'availability' },
    })

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
