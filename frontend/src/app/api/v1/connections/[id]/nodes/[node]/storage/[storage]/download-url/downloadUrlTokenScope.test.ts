/**
 * The node fetches the download URL itself, following redirects and resolving
 * the name on its own, so no pre-flight can keep it off a private network. An
 * API token may only name an http(s) URL, and a vDC tenant token is refused
 * outright. Sessions and provider tokens keep today's behaviour. Real route
 * and guard; principal, perimeter, tenant scope, the storage guard and Proxmox
 * are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  headersMock, getPrincipalMock, visibleMock, infraMock, creatorMock, auditMock, downloadMock,
} = vi.hoisted(() => ({
  headersMock: vi.fn<() => Promise<Headers>>(),
  getPrincipalMock: vi.fn<(...a: any[]) => Promise<any>>(),
  visibleMock: vi.fn<(...a: any[]) => Promise<Set<string>>>(),
  infraMock: vi.fn<(...a: any[]) => Promise<any>>(),
  creatorMock: vi.fn<(...a: any[]) => Promise<boolean>>(),
  auditMock: vi.fn<(...a: any[]) => Promise<string>>(),
  downloadMock: vi.fn<(...a: any[]) => Promise<string>>(),
}))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('@/lib/auth/principal', async io => ({
  ...await io<typeof import('@/lib/auth/principal')>(),
  getPrincipal: (...a: any[]) => getPrincipalMock(...a),
}))
vi.mock('@/lib/api-tokens/scope', () => ({ resolveVisibleConnectionIds: (...a: any[]) => visibleMock(...a) }))
vi.mock('@/lib/api-tokens/creatorCheck', () => ({ creatorStillHolds: (...a: any[]) => creatorMock(...a) }))
vi.mock('@/lib/tenant/infraScope', async io => ({
  ...await io<typeof import('@/lib/tenant/infraScope')>(),
  getTenantInfrastructureScope: (...a: any[]) => infraMock(...a),
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ id: 'conn-1', baseUrl: 'https://pve', apiToken: 't' }) }))
vi.mock('@/lib/proxmox/download', () => ({
  downloadToStorage: (...a: any[]) => downloadMock(...a),
  PveDownloadPermissionError: class extends Error {},
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: async () => null,
  buildStorageResourceId: (id: string, storage: string) => `${id}:${storage}`,
  PERMISSIONS: { STORAGE_UPLOAD: 'storage.upload' },
}))
vi.mock('@/lib/vdc/scope', () => ({
  guardTenantStorageWrite: async () => null,
  tenantUploadFilename: async (_id: string, _storage: string, name: string) => name,
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

import { POST } from './route'

const PATH = '/api/v1/connections/conn-1/nodes/pve1/storage/iso-a/download-url'
const UPID = 'UPID:pve1:0000ABCD:00001234:6A000000:download:debian.iso:root@pam:'
const TOKEN = {
  kind: 'token', tokenId: 'tok-a', tenantId: 'tenant-a', creatorUserId: 'u-a',
  connectionIds: null, scopes: ['storage:write'], permissions: new Set(['storage.upload']),
}
const SCHEME_REFUSED = { error: 'Download URL not allowed for this token' }
const VDC_REFUSED = { error: 'Download URL not available to a vDC tenant token' }

function download(url: string) {
  const req = new Request(`http://test.local${PATH}`, {
    method: 'POST',
    body: JSON.stringify({ url, content: 'iso', filename: 'debian.iso' }),
    headers: { 'content-type': 'application/json' },
  })
  return POST(req, { params: Promise.resolve({ id: 'conn-1', node: 'pve1', storage: 'iso-a' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  headersMock.mockResolvedValue(new Headers({
    authorization: 'Bearer pxc_abcdefgh_secret',
    'x-pxc-method': 'POST',
    'x-pxc-path': PATH,
    'x-pxc-entry': 'storage-download-url',
  }))
  getPrincipalMock.mockResolvedValue({ ok: true, principal: TOKEN })
  visibleMock.mockResolvedValue(new Set(['conn-1']))
  infraMock.mockResolvedValue({ kind: 'iaas', vdcScope: {} })
  creatorMock.mockResolvedValue(true)
  auditMock.mockResolvedValue('audit-1')
  downloadMock.mockResolvedValue(UPID)
})

describe('POST download-url with an API token', () => {
  it('403 for a non-http(s) URL, whatever the tenant', async () => {
    for (const kind of ['provider', 'iaas']) {
      infraMock.mockResolvedValue({ kind, vdcScope: {} })
      for (const url of ['ftp://mirror.example/debian.iso', 'file:///etc/shadow', 'not a url']) {
        const res = await download(url)
        expect(res.status, `${kind} ${url}`).toBe(403)
        expect(await res.json()).toEqual(SCHEME_REFUSED)
      }
    }
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('403 for a vDC tenant token on any http(s) URL, public or private', async () => {
    for (const url of ['https://cdimage.debian.org/debian.iso', 'http://10.0.0.5/x.iso', 'http://169.254.169.254/latest/meta-data']) {
      const res = await download(url)
      expect(res.status, url).toBe(403)
      expect(await res.json()).toEqual(VDC_REFUSED)
    }
    expect(infraMock).toHaveBeenCalledWith('tenant-a', { ignoreVdcContext: true })
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('a provider token may name an http(s) URL, private ones included (its own network)', async () => {
    infraMock.mockResolvedValue({ kind: 'provider' })

    const res = await download('http://10.0.0.5/x.iso')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: UPID })
    expect(new URLSearchParams(downloadMock.mock.calls[0][3]).get('url')).toBe('http://10.0.0.5/x.iso')
  })

  it('an msp token downloads too', async () => {
    infraMock.mockResolvedValue({ kind: 'msp' })

    expect((await download('https://cdimage.debian.org/debian.iso')).status).toBe(200)
    expect(downloadMock).toHaveBeenCalledTimes(1)
  })

  it('a session is unchanged: no URL restriction, no tenant lookup', async () => {
    getPrincipalMock.mockResolvedValue({ ok: true, principal: { kind: 'session', userId: 'u-1', tenantId: 'tenant-a' } })

    const res = await download('ftp://10.0.0.5/x.iso')

    expect(res.status).toBe(200)
    expect(infraMock).not.toHaveBeenCalled()
    expect(downloadMock).toHaveBeenCalledTimes(1)
  })
})
