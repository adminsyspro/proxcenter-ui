/**
 * #1004: GET .../disk/snapshot-refs?disk=<key> tells the disk dialog which
 * snapshots still reference the disk's volume, so it can warn before PVE
 * refuses a move with delete=1 or the removal of an unused disk.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const pveFetchMock = vi.fn<(conn: any, path: string) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: () => 'res',
  PERMISSIONS: { VM_CONFIG_HARDWARE: 'vm.config.hardware' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ id: 'conn-1' }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

async function loadGet() {
  const mod = await import('./route')
  return mod.GET as Parameters<typeof callRoute>[0]
}

const params = { id: 'conn-1', type: 'qemu', node: 'pve3', vmid: '100' }
const VOLID = 'local-lvm:vm-100-disk-0'

/** PVE answers keyed by path; anything else fails the test loudly. */
function pve(routes: Record<string, any>) {
  pveFetchMock.mockImplementation(async (_conn, path) => {
    if (!(path in routes)) throw new Error(`unexpected PVE call ${path}`)
    const r = routes[path]
    if (r instanceof Error) throw r
    return r
  })
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  pveFetchMock.mockReset()
})

describe('GET disk/snapshot-refs', () => {
  it('returns the snapshots whose config still holds the disk volume', async () => {
    pve({
      '/nodes/pve3/qemu/100/config': { scsi0: `${VOLID},size=32G` },
      '/nodes/pve3/qemu/100/snapshot': [
        { name: 'before-upgrade' }, { name: 'clean' }, { name: 'current' },
      ],
      '/nodes/pve3/qemu/100/snapshot/before-upgrade/config': { scsi0: `${VOLID},size=32G` },
      '/nodes/pve3/qemu/100/snapshot/clean/config': { scsi0: 'local-lvm:vm-100-disk-5,size=32G' },
    })

    const res = await callRoute(await loadGet(), { params, searchParams: { disk: 'scsi0' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { volid: VOLID, snapshots: ['before-upgrade'] } })
  })

  it('checks an unused disk against its bare volid', async () => {
    pve({
      '/nodes/pve3/qemu/100/config': { unused0: VOLID },
      '/nodes/pve3/qemu/100/snapshot': [{ name: 's1' }, { name: 'current' }],
      '/nodes/pve3/qemu/100/snapshot/s1/config': { scsi0: `${VOLID},size=32G` },
    })

    const res = await callRoute(await loadGet(), { params, searchParams: { disk: 'unused0' } })

    expect((await res.json()).data.snapshots).toEqual(['s1'])
  })

  it('uses the lxc endpoints for a container', async () => {
    const ct = 'local:subvol-200-disk-1'
    pve({
      '/nodes/pve3/lxc/200/config': { mp0: `${ct},mp=/data` },
      '/nodes/pve3/lxc/200/snapshot': [{ name: 'a' }],
      '/nodes/pve3/lxc/200/snapshot/a/config': { mp0: `${ct},mp=/data` },
    })

    const res = await callRoute(await loadGet(), {
      params: { ...params, type: 'lxc', vmid: '200' }, searchParams: { disk: 'mp0' },
    })

    expect((await res.json()).data.snapshots).toEqual(['a'])
  })

  it('does not fetch any snapshot config when the guest has no snapshot', async () => {
    pve({
      '/nodes/pve3/qemu/100/config': { scsi0: `${VOLID},size=32G` },
      '/nodes/pve3/qemu/100/snapshot': [{ name: 'current' }],
    })

    const res = await callRoute(await loadGet(), { params, searchParams: { disk: 'scsi0' } })

    expect((await res.json()).data).toEqual({ volid: VOLID, snapshots: [] })
  })

  it('refuses a key that is not a disk', async () => {
    const res = await callRoute(await loadGet(), { params, searchParams: { disk: 'net0' } })

    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('requires the hardware permission the move and delete actions need', async () => {
    checkPermissionMock.mockResolvedValue(new Response(null, { status: 403 }))

    const res = await callRoute(await loadGet(), { params, searchParams: { disk: 'scsi0' } })

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.config.hardware', 'vm', 'res')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('reports a PVE failure as an error, not as "no snapshot"', async () => {
    pve({
      '/nodes/pve3/qemu/100/config': { scsi0: `${VOLID},size=32G` },
      '/nodes/pve3/qemu/100/snapshot': new Error('PVE 500'),
    })

    const res = await callRoute(await loadGet(), { params, searchParams: { disk: 'scsi0' } })

    expect(res.status).toBe(500)
  })
})
