import { describe, it, expect, vi, beforeEach } from 'vitest'

const checkPermissionMock = vi.fn<(...a: any[]) => Promise<any>>()
const getCurrentTenantIdMock = vi.fn<() => Promise<string>>()
const findManyMock = vi.fn<(...a: any[]) => Promise<any[]>>()
const getEffectiveCatalogMock = vi.fn<() => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { VM_VIEW: 'vm.view' },
}))
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: () => getCurrentTenantIdMock(),
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { customImage: { findMany: (...a: any[]) => findManyMock(...a) } },
}))
vi.mock('@/lib/templates/catalogStore', () => ({
  getEffectiveCatalog: () => getEffectiveCatalogMock(),
}))

import { GET } from './route'

const meta = {
  source: 'remote', catalogUpdatedAt: '2026-10-01', fetchedAt: '2026-09-05T10:00:00.000Z',
  lastCheckedAt: '2026-09-05T10:00:00.000Z', lastResult: 'updated', lastError: null,
  url: 'https://raw.githubusercontent.com/x', autoUpdate: true,
}
const img = (slug: string, vendor: string) => ({
  slug, name: slug, vendor, version: '1', arch: 'amd64', format: 'qcow2',
  downloadUrl: 'https://img.test/a.qcow2', checksumUrl: null, defaultDiskSize: '20G',
  minMemory: 512, recommendedMemory: 2048, minCores: 1, recommendedCores: 2, ostype: 'l26', tags: [], logoIcon: 'ri-cloud-line',
})

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getCurrentTenantIdMock.mockReset().mockResolvedValue('default')
  findManyMock.mockReset().mockResolvedValue([])
  getEffectiveCatalogMock.mockReset().mockResolvedValue({
    images: [img('ubuntu-2404', 'ubuntu'), img('debian-13', 'debian')],
    vendors: [{ id: 'ubuntu', name: 'Ubuntu', icon: 'ri-ubuntu-fill' }, { id: 'debian', name: 'Debian', icon: 'ri-debian-fill' }],
    meta,
  })
})

describe('GET /api/v1/templates/catalog', () => {
  it('serves the effective catalog with its meta block and built-in flags', async () => {
    const res = await GET(new Request('http://localhost/api/v1/templates/catalog'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.meta).toEqual(meta)
    expect(body.data.images.map((i: any) => i.slug)).toEqual(['ubuntu-2404', 'debian-13'])
    expect(body.data.images[0]).toMatchObject({ isCustom: false, isShared: true })
    expect(body.data.vendors.map((v: any) => v.id)).toEqual(['ubuntu', 'debian'])
  })

  it('filters built-in images by vendor and still returns meta', async () => {
    const res = await GET(new Request('http://localhost/api/v1/templates/catalog?vendor=debian'))
    const body = await res.json()
    expect(body.data.images.map((i: any) => i.slug)).toEqual(['debian-13'])
    expect(body.data.meta.source).toBe('remote')
  })

  it('appends custom vendors missing from the effective vendor list', async () => {
    findManyMock.mockResolvedValue([{
      slug: 'custom-x', name: 'X', vendor: 'acme', version: '', arch: 'amd64', format: 'qcow2', sourceType: 'url',
      downloadUrl: 'https://img.test/x.qcow2', checksumUrl: null, volumeId: null, defaultDiskSize: '20G',
      minMemory: 512, recommendedMemory: 2048, minCores: 1, recommendedCores: 2, ostype: 'l26', tags: null, isShared: false,
    }])
    const res = await GET(new Request('http://localhost/api/v1/templates/catalog'))
    const body = await res.json()
    expect(body.data.vendors.map((v: any) => v.id)).toEqual(['ubuntu', 'debian', 'acme'])
    expect(body.data.images.at(-1)).toMatchObject({ slug: 'custom-x', isCustom: true })
  })

  it('returns the permission denial untouched', async () => {
    const denied = new Response(JSON.stringify({ error: 'nope' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)
    const res = await GET(new Request('http://localhost/api/v1/templates/catalog'))
    expect(res.status).toBe(403)
  })
})
