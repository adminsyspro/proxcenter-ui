/**
 * The non-PBS paths of /storage/[storage] (roadmap#202): config read without
 * secrets, edit, and removal with its usage check. The PBS detach keeps its
 * own file (route.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute, deniedPermissionResponse, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(), PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage' } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn() }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: vi.fn(), getSessionPrisma: vi.fn() }))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: vi.fn(), maskingScope: vi.fn() }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/storage/attachPbsStorage', () => ({ detachPbsStorage: vi.fn(), PbsAttachError: class extends Error {} }))
vi.mock('@/lib/proxmox/client', () => {
  class PveApplicationError extends Error {
    statusCode: number

    constructor(message: string, statusCode: number) {
      super(message)
      this.statusCode = statusCode
    }
  }

  return { pveFetch: vi.fn(), PveApplicationError }
})

import { audit } from '@/lib/audit'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch, PveApplicationError } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { detachPbsStorage } from '@/lib/storage/attachPbsStorage'
import { getCurrentTenantId } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'

import { DELETE, GET, PUT } from './route'

const conn = { id: 'c1', name: 'prod' }
const pve = vi.mocked(pveFetch)
const cifs = { type: 'cifs', storage: 'smb', server: 's', share: 'x', username: 'u', content: 'iso', digest: 'd1', nodes: 'pve1' }

function route(map: Record<string, any>) {
  pve.mockImplementation(async (_c: any, path: string, init?: any) => {
    const key = `${init?.method || 'GET'} ${path}`
    if (!(key in map)) throw new Error(`unexpected ${key}`)
    const v = map[key]
    if (v instanceof Error) throw v
    return typeof v === 'function' ? v(init) : v
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(checkPermission).mockResolvedValue(null)
  vi.mocked(getCurrentTenantId).mockResolvedValue('default')
  vi.mocked(getTenantInfrastructureScope).mockResolvedValue({ kind: 'provider' } as any)
  vi.mocked(maskingScope).mockReturnValue(null)
  vi.mocked(getConnectionById).mockResolvedValue(conn as any)
})

describe('GET /storage/[storage]', () => {
  it('returns the config without its secrets', async () => {
    route({ 'GET /storage/smb': { ...cifs, password: 'p' } })

    const res = await callRoute(GET, { method: 'GET', params: { id: 'c1', storage: 'smb' } })

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data).toEqual(cifs)
  })

  it('relays a Proxmox refusal', async () => {
    route({ 'GET /storage/smb': new (PveApplicationError as any)('PVE 404 /storage/smb: {"message":"no such storage"}', 404) })

    const res = await callRoute(GET, { method: 'GET', params: { id: 'c1', storage: 'smb' } })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'no such storage' })
  })

  it.each([
    ['without connection.manage', () => vi.mocked(checkPermission).mockResolvedValue(deniedPermissionResponse() as any), 403],
    ['for a vDC tenant', () => vi.mocked(maskingScope).mockReturnValue({} as any), 403],
  ])('refuses %s before reading Proxmox', async (_l, arrange, status) => {
    arrange()

    const res = await callRoute(GET, { method: 'GET', params: { id: 'c1', storage: 'smb' } })

    expect(res.status).toBe(status)
    expect(pve).not.toHaveBeenCalled()
  })

  it('refuses a malformed storage id and missing params', async () => {
    expect((await callRoute(GET, { method: 'GET', params: { id: 'c1', storage: 'a b' } })).status).toBe(400)
    expect((await callRoute(GET, { method: 'GET', params: { id: 'c1' } })).status).toBe(400)
  })
})

describe('PUT /storage/[storage]', () => {
  it('writes the editable fields bound to the digest, clearing only what is set', async () => {
    let sent: URLSearchParams | null = null
    route({ 'GET /storage/smb': cifs, 'PUT /storage/smb': (init: any) => { sent = init.body; return null } })

    const res = await callRoute(PUT, {
      method: 'PUT',
      params: { id: 'c1', storage: 'smb' },
      body: { fields: { server: 'changed', username: 'u2', password: 'n3w-pass', domain: '' }, content: ['iso', 'backup'], nodes: [], enabled: true },
    })

    expect(res.status).toBe(200)
    expect(Object.fromEntries(sent!)).toEqual({ username: 'u2', password: 'n3w-pass', content: 'iso,backup', delete: 'nodes', digest: 'd1' })
    const row = vi.mocked(audit).mock.calls.map(c => c[0] as any).find(r => r.details?.type === 'cifs')
    expect(row).toMatchObject({ action: 'update', status: 'success' })
    expect(JSON.stringify(row)).not.toContain('n3w-pass')
  })

  it('refuses a type it does not edit, and a bad body', async () => {
    route({ 'GET /storage/thin': { type: 'lvmthin' } })

    expect((await callRoute(PUT, { method: 'PUT', params: { id: 'c1', storage: 'thin' }, body: { content: ['images'] } })).status).toBe(400)
    expect((await callRoute(PUT, { method: 'PUT', params: { id: 'c1', storage: 'thin' } })).status).toBe(400)
  })

  it('answers 400 on an invalid change, before writing', async () => {
    route({ 'GET /storage/smb': cifs })

    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'c1', storage: 'smb' }, body: { content: ['images', 'bogus'] } })

    expect(res.status).toBe(400)
    expect(pve).toHaveBeenCalledTimes(1)
  })

  it('relays a refused write with the secret masked, and audits it', async () => {
    route({ 'GET /storage/smb': cifs, 'PUT /storage/smb': new (PveApplicationError as any)('PVE 400 /storage/smb: {"message":"bad sekret-1"}', 400) })

    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'c1', storage: 'smb' }, body: { fields: { password: 'sekret-1' }, content: ['iso'] } })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: 'bad ***' })
    expect(vi.mocked(audit).mock.calls.map(c => c[0] as any).find(r => r.errorMessage === 'bad ***')).toMatchObject({ status: 'failure' })
    expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain('sekret-1')
  })
})

describe('DELETE /storage/[storage]: other types', () => {
  const del = (storage: string, force = false) =>
    callRoute(DELETE, { method: 'DELETE', params: { id: 'c1', storage }, searchParams: force ? { force: '1' } : undefined })

  it('removes an unused storage and audits it, never through the PBS path', async () => {
    route({
      'GET /storage/nfs1': { type: 'nfs', shared: 1 },
      'GET /nodes': [{ node: 'pve1' }],
      'GET /nodes/pve1/storage/nfs1/content': [{ volid: 'nfs1:iso/a.iso', content: 'iso' }],
      'GET /cluster/backup': [],
      'GET /storage': [],
      'DELETE /storage/nfs1': null,
    })

    const res = await del('nfs1')

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { storage: 'nfs1', removed: true } })
    expect(detachPbsStorage).not.toHaveBeenCalled()
    expect(vi.mocked(audit).mock.calls.map(c => c[0] as any).find(r => r.details?.type === 'nfs')).toMatchObject({ action: 'delete', status: 'success', details: { type: 'nfs', forced: false } })
  })

  it('refuses while guests, backup jobs or other storages use it', async () => {
    route({
      'GET /storage/iscsi1': { type: 'iscsi' },
      'GET /nodes': [{ node: 'pve1' }],
      'GET /nodes/pve1/storage/iscsi1/content': [{ volid: 'iscsi1:0.0.0.x', vmid: 0, content: 'images' }, { volid: 'iscsi1:0.0.1.y', vmid: 101, content: 'images' }],
      'GET /cluster/backup': [{ id: 'job1', storage: 'iscsi1' }],
      'GET /storage': [{ storage: 'lvm1', base: 'iscsi1:0.0.0.x' }],
    })

    const res = await del('iscsi1')

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({
      error: 'This storage is still in use', code: 'STORAGE_IN_USE', vmids: [101], volumes: 1, backupJobs: ['job1'], storages: ['lvm1'],
    })
  })

  it('asks before removing a storage it could not read everywhere, and removes it with force', async () => {
    const map = {
      'GET /storage/d1': { type: 'dir', nodes: 'pve1' },
      'GET /nodes': new Error('down'),
      'GET /nodes/pve1/storage/d1/content': new Error('disabled'),
      'GET /cluster/backup': [],
      'GET /storage': [],
      'DELETE /storage/d1': null,
    }
    route(map)

    const first = await del('d1')

    expect(first.status).toBe(409)
    expect(await readJson(first)).toEqual({ error: 'The usage of this storage could not be read everywhere', code: 'STORAGE_USAGE_UNVERIFIED', unverified: ['pve1'] })

    const forced = await del('d1', true)

    expect(forced.status).toBe(200)
    expect(vi.mocked(audit).mock.calls.map(c => c[0] as any).find(r => r.details?.forced !== undefined && r.status === 'success')).toMatchObject({ details: { forced: true, unverified: ['pve1'] } })
  })

  it('relays a refused removal', async () => {
    route({
      'GET /storage/d2': { type: 'dir', shared: 1 },
      'GET /nodes': [{ node: 'pve1' }],
      'GET /nodes/pve1/storage/d2/content': [],
      'GET /cluster/backup': [],
      'GET /storage': [],
      'DELETE /storage/d2': new (PveApplicationError as any)('PVE 403 /storage/d2: {"message":"no"}', 403),
    })

    const res = await del('d2')

    expect(res.status).toBe(403)
    expect(await readJson(res)).toEqual({ error: 'no' })
  })

  it('keeps the PBS path for a pbs storage or an unreadable config', async () => {
    vi.mocked(detachPbsStorage).mockResolvedValue({ storage: 'pbs1', token: 'revoked' } as any)
    vi.mocked((await import('@/lib/tenant')).getSessionPrisma).mockResolvedValue({ connection: { findMany: vi.fn().mockResolvedValue([]) } } as any)
    route({ 'GET /storage/pbs1': { type: 'pbs' } })

    expect((await del('pbs1')).status).toBe(200)

    route({ 'GET /storage/pbs1': new Error('down') })
    expect((await del('pbs1')).status).toBe(200)
    expect(detachPbsStorage).toHaveBeenCalledTimes(2)
  })
})
