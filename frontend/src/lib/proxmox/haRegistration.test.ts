import { describe, expect, it, vi, beforeEach } from 'vitest'

const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const requireProviderTenantMock = vi.fn<() => Promise<Response | null>>()
const pveFetchMock = vi.fn<(...a: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({ checkPermission: (...a: any[]) => checkPermissionMock(...a), PERMISSIONS: { NODE_MANAGE: 'node.manage' } }))
vi.mock('@/lib/tenant', () => ({ requireProviderTenant: () => requireProviderTenantMock() }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

import { driveStoragesOf, haPermissionDenied, nonSharedStorages, registerHaResource } from './haRegistration'

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  pveFetchMock.mockReset()
})

describe('haPermissionDenied', () => {
  it('asks node.manage on the connection, then the provider tenant', async () => {
    expect(await haPermissionDenied('conn-1')).toBeNull()
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage', 'connection', 'conn-1')
    expect(requireProviderTenantMock).toHaveBeenCalled()
  })

  it('returns the RBAC refusal without asking the tenant', async () => {
    const denied = new Response('no', { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)
    expect(await haPermissionDenied('conn-1')).toBe(denied)
    expect(requireProviderTenantMock).not.toHaveBeenCalled()
  })

  it('returns the tenant refusal', async () => {
    const denied = new Response('provider only', { status: 403 })
    requireProviderTenantMock.mockResolvedValue(denied)
    expect(await haPermissionDenied('conn-1')).toBe(denied)
  })
})

describe('driveStoragesOf', () => {
  it('lists the storages of disks, EFI and TPM, without cdroms or empty drives', () => {
    expect(driveStoragesOf({
      sata0: 'Dir-Images:9940/base-9940-disk-1.qcow2,size=60G',
      efidisk0: 'ceph:vm-1-disk-0,efitype=4m',
      tpmstate0: 'ceph:vm-1-disk-2,size=4M',
      ide2: 'ISO:iso/win.iso,media=cdrom',
      ide0: 'none,media=cdrom',
      scsi1: 'Dir-Images:9940/vm-9940-disk-3.qcow2',
      net0: 'virtio=AA:BB,bridge=vmbr0',
      unused0: 'local:vm-1-disk-9',
      virtio0: 42 as any,
    })).toEqual(['Dir-Images', 'ceph'])
  })

  it('returns nothing for a missing config', () => {
    expect(driveStoragesOf(null)).toEqual([])
  })
})

describe('nonSharedStorages', () => {
  it('keeps the local and the unknown storages, once each', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/storage/ceph') return { type: 'rbd' }
      if (path === '/storage/nfs-flagged') return { type: 'dir', shared: 1 }
      if (path === '/storage/local') return { type: 'dir' }
      throw new Error('no such storage')
    })
    expect(await nonSharedStorages({} as any, ['ceph', 'local', 'nfs-flagged', 'gone', 'local'])).toEqual(['local', 'gone'])
    expect(pveFetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('registerHaResource', () => {
  it('posts vm:<id> with the requested state', async () => {
    pveFetchMock.mockResolvedValue(null)
    await registerHaResource({} as any, 190, 'started')
    const [, path, opts] = pveFetchMock.mock.calls[0]
    expect(path).toBe('/cluster/ha/resources')
    expect(opts.method).toBe('POST')
    expect(Object.fromEntries(new URLSearchParams(opts.body))).toEqual({ sid: 'vm:190', state: 'started' })
  })

  it('uses ct:<id> for a container', async () => {
    pveFetchMock.mockResolvedValue(null)
    await registerHaResource({} as any, '300', 'stopped', 'lxc')
    expect(new URLSearchParams(pveFetchMock.mock.calls[0][2].body).get('sid')).toBe('ct:300')
  })
})
