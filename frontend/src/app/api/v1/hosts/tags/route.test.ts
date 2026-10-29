import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { upsertMock, connFindMock, checkPermissionMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  connFindMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

// The session client: a connection of another tenant reads as null.
vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ managedHost: { upsert: upsertMock }, connection: { findUnique: connFindMock } }),
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

import { PATCH } from './route'

const patch = (body: any) => callRoute(PATCH as any, { method: 'PATCH', body })

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  connFindMock.mockReset().mockResolvedValue({ id: 'c1' })
  upsertMock.mockReset().mockImplementation(async ({ create }: any) => ({ id: 'h1', tags: create.tags }))
})

describe('PATCH /api/v1/hosts/tags', () => {
  it('saves the tags of a node of a connection the caller owns', async () => {
    const res = await patch({ connectionId: 'c1', node: 'pve1', tags: 'rack-4' })

    expect(res.status).toBe(200)
    expect(connFindMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' } }))
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { connectionId_node: { connectionId: 'c1', node: 'pve1' } },
      update: { tags: 'rack-4' },
    }))
    expect((await readJson<any>(res)).data).toEqual({ id: 'h1', tags: 'rack-4' })
  })

  it('creates no host row on a connection of another tenant (roadmap#99)', async () => {
    connFindMock.mockResolvedValueOnce(null)

    const res = await patch({ connectionId: 'c-provider', node: 'pve3', tags: 'x' })

    expect(res.status).toBe(404)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('needs a connection and a node', async () => {
    expect((await patch({ node: 'pve1' })).status).toBe(400)
    expect((await patch({ connectionId: 'c1' })).status).toBe(400)
    expect(connFindMock).not.toHaveBeenCalled()
  })

  it('keeps the admin settings permission gate', async () => {
    checkPermissionMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))

    expect((await patch({ connectionId: 'c1', node: 'pve1', tags: 'x' })).status).toBe(403)
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
