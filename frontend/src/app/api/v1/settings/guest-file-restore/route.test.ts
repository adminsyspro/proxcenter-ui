import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { adminGuardMock, userGuardMock, loadMock, saveMock, auditMock } = vi.hoisted(() => ({
  adminGuardMock: vi.fn(),
  userGuardMock: vi.fn(),
  loadMock: vi.fn(),
  saveMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/guestFileRestore/guard', () => ({
  requireGuestFileRestoreAdmin: () => adminGuardMock(),
  requireGuestFileRestoreUser: () => userGuardMock(),
}))
vi.mock('@/lib/guestFileRestore/settings', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/guestFileRestore/settings')>()),
  loadGuestFileRestoreSettings: () => loadMock(),
  saveGuestFileRestoreSettings: (...a: any[]) => saveMock(...a),
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

import { DEFAULT_GUEST_FILE_RESTORE_SETTINGS } from '@/lib/guestFileRestore/settings'

import { GET, PUT } from './route'

beforeEach(() => {
  adminGuardMock.mockReset().mockResolvedValue({ denied: null, userId: 'u1', userEmail: 'u1@example.org' })
  userGuardMock.mockReset().mockResolvedValue({ denied: null, principal: { kind: 'session', userId: 'u2', tenantId: 'default' } })
  loadMock.mockReset().mockResolvedValue({ ...DEFAULT_GUEST_FILE_RESTORE_SETTINGS })
  saveMock.mockReset().mockImplementation(async (v: any) => v)
  auditMock.mockReset().mockResolvedValue('a1')
})

describe('GET /api/v1/settings/guest-file-restore', () => {
  it('returns the effective settings to any licensed user', async () => {
    const res = await callRoute(GET, { method: 'GET' })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: DEFAULT_GUEST_FILE_RESTORE_SETTINGS })
    expect(adminGuardMock).not.toHaveBeenCalled()
  })
  it('propagates the user guard refusal', async () => {
    userGuardMock.mockResolvedValue({ denied: new Response(null, { status: 403 }) })
    expect((await callRoute(GET, { method: 'GET' })).status).toBe(403)
  })
})

describe('PUT /api/v1/settings/guest-file-restore', () => {
  it('validates, saves and audits before/after', async () => {
    const body = { ...DEFAULT_GUEST_FILE_RESTORE_SETTINGS, sshEnabled: false, maxConcurrentJobs: 5 }
    const res = await callRoute(PUT, { method: 'PUT', body })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: body })
    expect(saveMock).toHaveBeenCalledWith(body)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'update',
      category: 'settings',
      resourceType: 'guest_file_restore_settings',
      details: { before: DEFAULT_GUEST_FILE_RESTORE_SETTINGS, after: body },
    }))
  })
  it('rejects out-of-range values with the issues', async () => {
    const res = await callRoute(PUT, { method: 'PUT', body: { maxConcurrentJobs: 50, restoredPrefix: 'a/b' } })
    expect(res.status).toBe(400)
    const json = (await readJson(res)) as any
    expect(json.issues.map((i: any) => i.path).sort()).toEqual(['maxConcurrentJobs', 'restoredPrefix'])
    expect(saveMock).not.toHaveBeenCalled()
  })
  it('rejects invalid JSON and requires the admin guard', async () => {
    expect((await callRoute(PUT, { method: 'PUT', body: '{nope' })).status).toBe(400)
    adminGuardMock.mockResolvedValue({ denied: new Response(null, { status: 403 }) })
    expect((await callRoute(PUT, { method: 'PUT', body: {} })).status).toBe(403)
  })
})
