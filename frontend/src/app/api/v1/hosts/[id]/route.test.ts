import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { updateMock, deleteMock, hostFindMock, connFindMock, checkPermissionMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  hostFindMock: vi.fn(),
  connFindMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

// The session client: rows of another tenant read as null.
vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    managedHost: { update: updateMock, delete: deleteMock, findUnique: hostFindMock },
    connection: { findUnique: connFindMock },
  }),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

import { DELETE, PATCH } from './route'

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  deleteMock.mockReset().mockResolvedValue({})
  hostFindMock.mockReset().mockResolvedValue({ connectionId: 'c1' })
  connFindMock.mockReset().mockResolvedValue({ id: 'c1' })
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

describe('PATCH /api/v1/hosts/[id]: SSH address format', () => {
  it.each([
    '10.42.0.250 evil',
    'ssh://10.42.0.250/x',
    'root@10.42.0.101',
    '10.42.0.101:22',
    '-oProxyCommand=x',
    '300.1.1.1',
  ])('refuses %s with a 400 and writes nothing', async (address) => {
    const res = await patch({ sshAddress: address })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/host name or an IP address/)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it.each(['10.42.0.101', 'pve1.lab.local', 'fd00::101', '::1'])('stores %s', async (address) => {
    const res = await patch({ sshAddress: address })

    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { sshAddress: address } }))
  })
})

describe('/api/v1/hosts/[id]: the row and its connection belong to the caller', () => {
  it('answers 404 and writes nothing when the row is not visible to the session', async () => {
    hostFindMock.mockResolvedValueOnce(null)

    const res = await patch({ sshAddress: '10.42.0.250' })

    expect(res.status).toBe(404)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('answers 404 when the connection of the row belongs to another tenant', async () => {
    connFindMock.mockResolvedValueOnce(null)

    const res = await patch({ sshAddress: '10.42.0.250' })

    expect(res.status).toBe(404)
    expect(connFindMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' } }))
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('accepts a row without a connection', async () => {
    hostFindMock.mockResolvedValueOnce({ connectionId: null })

    const res = await patch({ notes: 'rack 4' })

    expect(res.status).toBe(200)
    expect(connFindMock).not.toHaveBeenCalled()
  })

  it('DELETE answers 404 for a row of another connection owner and deletes nothing', async () => {
    connFindMock.mockResolvedValueOnce(null)

    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'h1' } })

    expect(res.status).toBe(404)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('DELETE removes a reachable row', async () => {
    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'h1' } })

    expect(res.status).toBe(200)
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: 'h1' } })
  })
})
