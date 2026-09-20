import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tenant: vi.fn(), infra: vi.fn(), permission: vi.fn(), pve: vi.fn(), connection: vi.fn(),
  create: vi.fn(), update: vi.fn(), find: vi.fn(),
}))
vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default', getCurrentTenantId: mocks.tenant,
  getSessionPrisma: async () => ({ customImage: { create: mocks.create, update: mocks.update, findUnique: mocks.find } }),
}))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: mocks.infra }))
vi.mock('@/lib/rbac', () => ({ checkPermission: mocks.permission, PERMISSIONS: { VM_CREATE: 'vm.create', VM_CLONE: 'vm.clone' }, buildVmResourceId: (...parts: string[]) => parts.join(':') }))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'user-a' } }) }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: mocks.connection }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: mocks.pve }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { tenant: { findUnique: async () => ({ slug: 'acme' }), findMany: async () => [{ id: 'tenant-a', slug: 'acme' }, { id: 'tenant-b', slug: 'acme-prod' }] } } }))
vi.mock('@/lib/audit', () => ({ audit: async () => {} }))

import { POST } from './route'
import { PUT } from './[id]/route'
import { authorizeImageVolume } from '@/lib/templates/sourceVolume'

const body = { name: 'Disk image', sourceType: 'volume', volumeId: 'shared:vm-201-disk-0', sourceConnectionId: 'conn-a', sourceNode: 'pve1' }
const request = (data: object) => new Request('http://localhost/api/v1/templates/custom-images', { method: 'POST', body: JSON.stringify(data) })
const scope = () => ({
  connectionIds: new Set(['conn-a']), nodesByConnection: new Map([['conn-a', new Set(['pve1'])]]),
  storagesByConnection: new Map([['conn-a', new Set(['shared', 'library', 'nas.isos'])]]),
  writableStoragesByConnection: new Map([['conn-a', new Set(['shared'])]]),
  isoLibrariesByConnection: new Map([['conn-a', new Set(['library', 'nas.isos'])]]),
  poolsByConnection: new Map([['conn-a', new Set(['pool-a'])]]),
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tenant.mockResolvedValue('tenant-a')
  mocks.infra.mockResolvedValue({ kind: 'iaas', vdcScope: scope() })
  mocks.permission.mockResolvedValue(null)
  mocks.connection.mockResolvedValue({ id: 'conn-a' })
  mocks.find.mockResolvedValue(null)
  mocks.create.mockImplementation(async ({ data }) => ({ id: 'image-a', ...data }))
  mocks.update.mockImplementation(async ({ data }) => ({ id: 'image-a', ...data }))
  mocks.pve.mockImplementation(async (_conn, path) => {
    if (path.endsWith('/content')) return [{ volid: body.volumeId, content: 'images', vmid: 201 }]
    if (path === '/cluster/resources?type=vm') return [{ vmid: 201, type: 'qemu', node: 'pve1', pool: 'pool-a' }]
    return { shared: 1, type: 'rbd' }
  })
})

describe('custom image source authorization', () => {
  it('rejects a source on an unauthorized storage before saving an image', async () => {
    const response = await POST(request({ ...body, volumeId: 'foreign:vm-201-disk-0' }))
    expect(response.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.pve).not.toHaveBeenCalled()
  })

  it('rejects another tenant disk on a storage both tenants can use', async () => {
    mocks.pve.mockImplementation(async (_conn, path) => path.endsWith('/content')
      ? [{ volid: body.volumeId, content: 'images', vmid: 201 }]
      : [{ vmid: 201, type: 'qemu', node: 'pve1', pool: 'pool-b' }])
    const response = await POST(request(body))
    expect(response.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('cannot bypass source checks by updating an existing URL image', async () => {
    mocks.find.mockResolvedValue({ id: 'image-a', tenantId: 'tenant-a', sourceType: 'url', downloadUrl: 'https://example.test/image.qcow2' })
    const response = await PUT(request({ ...body, volumeId: 'foreign:vm-201-disk-0' }), { params: Promise.resolve({ id: 'image-a' }) })
    expect(response.status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('records the selected cluster and node when the tenant owns the source disk', async () => {
    const response = await POST(request(body))
    expect(response.status).toBe(201)
    const result = await response.json()
    expect(result.data.sourceConnectionId).toBe('conn-a')
    expect(result.data.sourceNode).toBe('pve1')
  })

  it.each(['shared:vm-201-disk-0,import-from=foreign:disk', 'shared:../secret', 'shared:/etc/passwd', 'shared:import/%2e%2e/file', 'shared:import//file'])('rejects ambiguous or injected volume %s', async volumeId => {
    const response = await POST(request({ ...body, volumeId }))
    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([{ sourceConnectionId: 'foreign' }, { sourceNode: 'pve9' }])('rejects an unauthorized source location %o', async location => {
    const response = await POST(request({ ...body, ...location }))
    expect(response.status).toBe(403)
    expect(mocks.pve).not.toHaveBeenCalled()
  })

  it('requires source coordinates even when a tenant forges sharing flags', async () => {
    const response = await POST(request({ name: 'Unbound', sourceType: 'volume', volumeId: body.volumeId, isShared: true, tenantId: 'default' }))
    expect(response.status).toBe(409)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('cannot grant itself publication access by setting isShared', async () => {
    // Provider storage outside the vDC: only a server-resolved published row
    // may open it, never a flag in the request.
    mocks.pve.mockResolvedValue([{ volid: 'provider-store:import/provider.qcow2', content: 'import' }])
    const response = await POST(request({ ...body, volumeId: 'provider-store:import/provider.qcow2', isShared: true, tenantId: 'default' }))
    expect(response.status).toBe(403)
    expect(mocks.pve).not.toHaveBeenCalled()
  })

  it.each([
    ['shared:import/custom-acme-disk.qcow2', 'import', 'qcow2', 201],
    ['shared:import/custom-acme-prod-disk.qcow2', 'import', 'qcow2', 403],
    ['shared:import/custom-unknown-disk.qcow2', 'import', 'qcow2', 403],
    ['library:iso/debian.iso', 'iso', 'iso', 201],
    ['library:iso/custom-acme-private.iso', 'iso', 'iso', 201],
    ['library:iso/custom-acme-prod-private.iso', 'iso', 'iso', 403],
    // The vDC's own writable storage: the storage browser uploads raw names
    // there (tenantUploadFilename only prefixes on libraries), so an unprefixed
    // file is the tenant's own, but another tenant's prefix still is not.
    ['shared:iso/debian.iso', 'iso', 'iso', 201],
    ['shared:import/ubuntu.qcow2', 'import', 'qcow2', 201],
    ['shared:iso/Win10_22H2 (x64).iso', 'iso', 'iso', 201],
    ['nas.isos:iso/debian.iso', 'iso', 'iso', 201],
    ['library:import/custom-acme-disk.qcow2', 'import', 'qcow2', 403],
    ['library:iso/debian.iso', 'iso', 'qcow2', 400],
    ['shared:vm-201-disk-0', 'images', 'iso', 400],
  ])('checks ownership and content for %s', async (volumeId, content, format, status) => {
    mocks.pve.mockResolvedValue([{ volid: volumeId, content }])
    const response = await POST(request({ ...body, volumeId, format }))
    expect(response.status).toBe(status)
  })

  it('fails closed when the source no longer exists', async () => {
    mocks.pve.mockResolvedValue([])
    expect((await POST(request(body))).status).toBe(403)
  })

  it('fails closed when storage cannot be read', async () => {
    mocks.pve.mockRejectedValue(new Error('PVE unavailable'))
    expect((await POST(request(body))).status).toBe(500)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('requires clone permission on a source disk even if its pool is owned', async () => {
    mocks.permission.mockImplementation(async permission => permission === 'vm.clone' ? new Response(null, { status: 403 }) : null)
    expect((await POST(request(body))).status).toBe(403)
  })

  it('does not infer disk ownership from its name when PVE omits vmid', async () => {
    mocks.pve.mockResolvedValue([{ volid: body.volumeId, content: 'images' }])
    expect((await POST(request(body))).status).toBe(403)
  })

  it('revalidates a partial volumeId edit using the stored source coordinates', async () => {
    mocks.find.mockResolvedValue({ ...body, id: 'image-a', tenantId: 'tenant-a' })
    const response = await PUT(request({ volumeId: 'foreign:vm-201-disk-0' }), { params: Promise.resolve({ id: 'image-a' }) })
    expect(response.status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('clears the source locator when switching back to a URL', async () => {
    mocks.find.mockResolvedValue({ ...body, id: 'image-a', tenantId: 'tenant-a' })
    const response = await PUT(request({ sourceType: 'url', downloadUrl: 'https://example.test/image.qcow2' }), { params: Promise.resolve({ id: 'image-a' }) })
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ volumeId: null, sourceConnectionId: null, sourceNode: null })
  })

  it('answers 404, not 500, when the source cluster no longer exists', async () => {
    mocks.infra.mockResolvedValue({ kind: 'provider' })
    mocks.connection.mockRejectedValue(new Error('Connection not found: conn-a'))
    expect((await POST(request(body))).status).toBe(404)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('renames a volume image without reaching its source cluster', async () => {
    mocks.find.mockResolvedValue({ ...body, id: 'image-a', tenantId: 'tenant-a' })
    mocks.pve.mockResolvedValue([])
    const response = await PUT(request({ name: 'Renamed', recommendedMemory: 4096 }), { params: Promise.resolve({ id: 'image-a' }) })
    expect(response.status).toBe(200)
    expect(mocks.pve).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalled()
  })

  describe('provider-published images (#971)', () => {
    const golden = { volumeId: 'provider-store:import/golden.qcow2', sourceConnectionId: 'conn-a', sourceNode: 'pve3', format: 'qcow2', tenantId: 'default', isShared: true }
    beforeEach(() => {
      mocks.pve.mockImplementation(async (_conn, path) => path.endsWith('/content')
        ? [{ volid: golden.volumeId, content: 'import' }]
        : { shared: 1, type: 'nfs' })
    })
    it('lets a tenant deploy a published image whose source is outside its vDC', async () => {
      await expect(authorizeImageVolume({ tenantId: 'tenant-a', source: golden, target: { connectionId: 'conn-a', node: 'pve1' }, publishedImage: golden })).resolves.toBeUndefined()
    })
    it('still refuses the same source when it is not published, or published from a tenant', async () => {
      await expect(authorizeImageVolume({ tenantId: 'tenant-a', source: golden, target: { connectionId: 'conn-a', node: 'pve1' } })).rejects.toMatchObject({ status: 403 })
      await expect(authorizeImageVolume({ tenantId: 'tenant-a', source: golden, target: { connectionId: 'conn-a', node: 'pve1' }, publishedImage: { ...golden, isShared: false } })).rejects.toMatchObject({ status: 403 })
      await expect(authorizeImageVolume({ tenantId: 'tenant-a', source: golden, target: { connectionId: 'conn-a', node: 'pve1' }, publishedImage: { ...golden, tenantId: 'tenant-b' } })).rejects.toMatchObject({ status: 403 })
    })
    it('keeps the node reachability check for a published image on restricted storage', async () => {
      mocks.pve.mockImplementation(async (_conn, path) => path.endsWith('/content')
        ? [{ volid: golden.volumeId, content: 'import' }]
        : { shared: 1, type: 'nfs', nodes: 'pve3,pve4' })
      await expect(authorizeImageVolume({ tenantId: 'tenant-a', source: golden, target: { connectionId: 'conn-a', node: 'pve1' }, publishedImage: golden })).rejects.toMatchObject({ status: 400 })
    })
  })

  it('rejects using the same volume name on another cluster', async () => {
    await expect(authorizeImageVolume({ tenantId: 'tenant-a', source: body, target: { connectionId: 'conn-b', node: 'pve1' } })).rejects.toMatchObject({ status: 400 })
    expect(mocks.pve).not.toHaveBeenCalled()
  })

  it('does not reuse a local volume name on another node', async () => {
    mocks.pve.mockResolvedValue({ type: 'dir', shared: 0 })
    await expect(authorizeImageVolume({ tenantId: 'tenant-a', source: body, target: { connectionId: 'conn-a', node: 'pve2' } })).rejects.toMatchObject({ status: 400 })
  })

  it('permits the selected shared volume on a different target node', async () => {
    await expect(authorizeImageVolume({ tenantId: 'tenant-a', source: body, target: { connectionId: 'conn-a', node: 'pve2' } })).resolves.toBeUndefined()
  })
  it('keeps URL image creation independent of source-volume permissions', async () => {
    const response = await POST(request({ name: 'URL', sourceType: 'url', downloadUrl: 'https://example.test/image.qcow2' }))
    expect(response.status).toBe(201)
    expect(mocks.pve).not.toHaveBeenCalled()
  })
})
