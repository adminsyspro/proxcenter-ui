import { describe, it, expect, vi, beforeEach } from 'vitest'

const checkPermissionMock = vi.fn<(...a: any[]) => Promise<any>>()
const getCurrentTenantIdMock = vi.fn<() => Promise<string>>()
const findCustomImageForTenantMock = vi.fn<(...a: any[]) => Promise<any>>()
const getConnectionByIdMock = vi.fn<(...a: any[]) => Promise<any>>()
const pveFetchMock = vi.fn<(...a: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({ checkPermission: (...a: any[]) => checkPermissionMock(...a), PERMISSIONS: { VM_CREATE: 'vm.create' } }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: () => getCurrentTenantIdMock() }))
vi.mock('@/lib/templates/customImageScope', () => ({ findCustomImageForTenant: (...a: any[]) => findCustomImageForTenantMock(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: any[]) => getConnectionByIdMock(...a) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

import { GET } from './route'

const url = (qs: string) => new Request(`http://localhost/api/v1/templates/hardware-hints?${qs}`)
const templateRow = {
  slug: 'custom-default-win', sourceType: 'volume', volumeId: 'Dir-Images:9940/base-9940-disk-1.qcow2',
  sourceConnectionId: 'conn-prod', sourceNode: 'pve1', extraLocations: [],
}
const templateConfig = {
  bios: 'ovmf', machine: 'pc-q35-11.0+pve2', sata0: 'Dir-Images:9940/base-9940-disk-1.qcow2,size=60G',
  tpmstate0: 'Dir-Images:9940/base-9940-disk-2.raw,size=4M,version=v2.0', vga: 'std', ostype: 'win10', template: 1,
  name: 'secret-template-name',
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getCurrentTenantIdMock.mockReset().mockResolvedValue('tenant-1')
  findCustomImageForTenantMock.mockReset().mockResolvedValue(templateRow)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-prod' })
  pveFetchMock.mockReset().mockImplementation(async (_c: any, path: string) => {
    if (path === '/cluster/resources?type=vm') return [{ vmid: 9940, type: 'qemu', node: 'pve2' }, { vmid: 9940, type: 'lxc', node: 'x' }]
    if (path === '/nodes/pve2/qemu/9940/config') return templateConfig
    throw new Error(`unexpected ${path}`)
  })
})

describe('GET /api/v1/templates/hardware-hints', () => {
  it('needs vm.create', async () => {
    checkPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    expect((await GET(url('imageSlug=a&connectionId=b'))).status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.create')
  })

  it('needs both query parameters', async () => {
    expect((await GET(url('imageSlug=a'))).status).toBe(400)
  })

  it('returns the hardware of the template that owns the image volume, and nothing else', async () => {
    const res = await GET(url('imageSlug=custom-default-win&connectionId=conn-prod'))
    const body = await res.json()
    expect(body.data).toEqual({ bios: 'ovmf', machine: 'q35', tpm: true, diskBus: 'sata', vga: 'std', ostype: 'win10' })
    expect(JSON.stringify(body)).not.toMatch(/secret-template-name|pve2/)
    expect(findCustomImageForTenantMock).toHaveBeenCalledWith('tenant-1', 'custom-default-win')
  })

  it('reads the copy held by the target cluster', async () => {
    findCustomImageForTenantMock.mockResolvedValue({
      ...templateRow,
      extraLocations: [{ connectionId: 'conn-dr', node: 'pve1-dr', volumeId: 'ceph:base-500-disk-0' }],
    })
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/resources?type=vm') return [{ vmid: 500, type: 'qemu', node: 'pve1-dr' }]
      if (path === '/nodes/pve1-dr/qemu/500/config') return { scsi0: 'ceph:base-500-disk-0,size=8G' }
      throw new Error(`unexpected ${path}`)
    })
    const body = await (await GET(url('imageSlug=custom-default-win&connectionId=conn-dr'))).json()
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-dr')
    expect(body.data.diskBus).toBe('scsi')
  })

  it.each([
    ['an unknown slug', null],
    ['a URL image', { ...templateRow, sourceType: 'url' }],
    ['an image file that belongs to no guest', { ...templateRow, volumeId: 'local:import/debian.qcow2' }],
    ['an image with no copy on the cluster', { ...templateRow, sourceConnectionId: 'conn-other' }],
  ])('returns null for %s', async (_label, row) => {
    findCustomImageForTenantMock.mockResolvedValue(row)
    const body = await (await GET(url('imageSlug=x&connectionId=conn-prod'))).json()
    expect(body.data).toBeNull()
  })

  it('returns null when the owning guest is gone', async () => {
    pveFetchMock.mockImplementation(async () => [])
    const body = await (await GET(url('imageSlug=x&connectionId=conn-prod'))).json()
    expect(body.data).toBeNull()
  })

  it('keeps the PVE error out of the response', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pveFetchMock.mockRejectedValue(new Error('500 on node pve-secret-7'))
    const res = await GET(url('imageSlug=x&connectionId=conn-prod'))
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(JSON.parse(text)).toEqual({ data: null })
    expect(text).not.toMatch(/pve-secret-7/)
    spy.mockRestore()
  })
})
