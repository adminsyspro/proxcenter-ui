import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ getRBACContext: vi.fn(), filterVmsByPermission: vi.fn() }))

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { VM_BACKUP: 'vm.backup' },
  getRBACContext: (...a: unknown[]) => m.getRBACContext(...a),
  filterVmsByPermission: (...a: unknown[]) => m.filterVmsByPermission(...a),
}))

import { denyJobGuestsOutsideBackupRight, jobSelection } from './jobGuestScope'

const guests = [
  { vmid: 100, node: 'pve1', type: 'qemu', tags: 'ops', pool: 'prod' },
  { vmid: 101, node: 'pve2', type: 'lxc' },
  { vmid: 200, node: 'pve1', type: 'qemu' },
  { storage: 'local', node: 'pve1', type: 'storage' } as any,
]

beforeEach(() => {
  vi.clearAllMocks()
  m.getRBACContext.mockResolvedValue({ userId: 'u1', tenantId: 't1', isAdmin: false })
})

describe('jobSelection', () => {
  it('reads the selection a body asks for', () => {
    expect(jobSelection({ selectionMode: 'all' })).toEqual({ mode: 'all', vmids: [] })
    expect(jobSelection({ selectionMode: 'pool', pool: 'prod' })).toEqual({ mode: 'pool', vmids: [] })
    expect(jobSelection({ selectionMode: 'include', vmids: [100, '101'] })).toEqual({ mode: 'include', vmids: ['100', '101'] })
  })

  it('keeps the stored job selection when an edit leaves it alone', () => {
    expect(jobSelection({ schedule: 'daily' }, { all: 1 })).toEqual({ mode: 'all', vmids: [] })
    expect(jobSelection({}, { all: 0, pool: 'prod' })).toEqual({ mode: 'pool', vmids: [] })
    expect(jobSelection({}, { vmid: '100, 200' })).toEqual({ mode: 'include', vmids: ['100', '200'] })
    // The body wins over the stored job.
    expect(jobSelection({ selectionMode: 'include', vmids: [100] }, { all: 1 })).toEqual({ mode: 'include', vmids: ['100'] })
  })
})

describe('denyJobGuestsOutsideBackupRight', () => {
  it('refuses a whole-cluster or pool job without asking for the guests', async () => {
    for (const sel of [{ mode: 'all', vmids: [] }, { mode: 'pool', vmids: [] }, { mode: 'include', vmids: [] }] as const) {
      const res = await denyJobGuestsOutsideBackupRight('c1', { ...sel, vmids: [...sel.vmids] }, guests)
      expect(res?.status).toBe(403)
    }
    expect(m.filterVmsByPermission).not.toHaveBeenCalled()
  })

  it('accepts named guests that all carry vm.backup, with their tags and pool for tag/pool grants', async () => {
    m.filterVmsByPermission.mockImplementation(async (_p: unknown, rows: unknown[]) => rows)
    expect(await denyJobGuestsOutsideBackupRight('c1', { mode: 'include', vmids: ['100', '101'] }, guests)).toBeNull()
    const [principal, rows, permission, tenantId] = m.filterVmsByPermission.mock.calls[0]
    expect(principal).toBe('u1')
    expect(permission).toBe('vm.backup')
    expect(tenantId).toBe('t1')
    expect(rows).toEqual([
      { connId: 'c1', node: 'pve1', type: 'qemu', vmid: '100', tags: 'ops', pool: 'prod' },
      { connId: 'c1', node: 'pve2', type: 'lxc', vmid: '101', tags: undefined, pool: undefined },
    ])
  })

  it('refuses when one named guest lacks vm.backup', async () => {
    m.filterVmsByPermission.mockImplementation(async (_p: unknown, rows: any[]) => rows.filter(r => r.vmid !== '200'))
    const res = await denyJobGuestsOutsideBackupRight('c1', { mode: 'include', vmids: ['100', '200'] }, guests)
    expect(res?.status).toBe(403)
  })

  it('refuses an unknown VMID without saying it does not exist', async () => {
    const res = await denyJobGuestsOutsideBackupRight('c1', { mode: 'include', vmids: ['100', '999'] }, guests)
    expect(res?.status).toBe(403)
    expect((await res!.json()).detail).toBe('The job names a guest you cannot back up')
  })

  it('lets a super admin through and fails closed without a caller', async () => {
    m.getRBACContext.mockResolvedValueOnce({ userId: 'admin', isAdmin: true })
    expect(await denyJobGuestsOutsideBackupRight('c1', { mode: 'include', vmids: ['100'] }, guests)).toBeNull()
    m.getRBACContext.mockResolvedValueOnce(null)
    expect((await denyJobGuestsOutsideBackupRight('c1', { mode: 'include', vmids: ['100'] }, guests))?.status).toBe(403)
  })
})
