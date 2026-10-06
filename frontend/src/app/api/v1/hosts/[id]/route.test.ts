import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { updateMock, checkPermissionMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ managedHost: { update: updateMock, delete: vi.fn() } }),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

import { PATCH } from './route'

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  updateMock.mockReset().mockImplementation(async ({ data }: any) => ({
    id: 'h1', connectionId: 'c1', connection: { name: 'PVE' }, node: 'pve1', enabled: true,
    sshAddress: null, sshPort: null, ...data,
  }))
})

const patch = (body: any) => callRoute(PATCH as any, { method: 'PATCH', params: { id: 'h1' }, body })

describe('PATCH /api/v1/hosts/[id]: SSH address and port override', () => {
  it('trims the address and stores a valid port', async () => {
    const res = await patch({ sshAddress: '  100.64.0.7  ', sshPort: 2201 })

    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { sshAddress: '100.64.0.7', sshPort: 2201 } }))
    const json = await readJson<any>(res)
    expect(json.data).toMatchObject({ sshAddress: '100.64.0.7', sshPort: 2201 })
  })

  it('accepts a numeric string port', async () => {
    await patch({ sshPort: '2202' })

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { sshPort: 2202 } }))
  })

  it('clears both overrides with null, an empty port or a blank address', async () => {
    await patch({ sshAddress: '   ', sshPort: null })
    expect(updateMock).toHaveBeenLastCalledWith(expect.objectContaining({ data: { sshAddress: null, sshPort: null } }))

    await patch({ sshAddress: null, sshPort: '' })
    expect(updateMock).toHaveBeenLastCalledWith(expect.objectContaining({ data: { sshAddress: null, sshPort: null } }))
  })

  it.each([0, 65536, -22, 22.5, 'ssh', '22a', true])('rejects port %s with a 400 and writes nothing', async (port) => {
    const res = await patch({ sshAddress: '100.64.0.7', sshPort: port })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/1 and 65535/)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('leaves the port untouched when the field is absent', async () => {
    await patch({ sshAddress: '10.0.0.9' })

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { sshAddress: '10.0.0.9' } }))
  })

  it('keeps the admin settings permission gate', async () => {
    checkPermissionMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))

    const res = await patch({ sshPort: 2201 })

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('admin.settings')
    expect(updateMock).not.toHaveBeenCalled()
  })
})
