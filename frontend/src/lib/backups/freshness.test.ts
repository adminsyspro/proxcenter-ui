import { describe, expect, it, vi, beforeEach } from 'vitest'

const { findManyMock, bindingsMock, getAllBackupsMock, getPbsConnectionByIdUnscopedMock } = vi.hoisted(() => ({
  findManyMock: vi.fn<(args?: any) => Promise<any[]>>(),
  bindingsMock: vi.fn<(args?: any) => Promise<any[]>>(),
  getAllBackupsMock: vi.fn<(...args: any[]) => Promise<any>>(),
  getPbsConnectionByIdUnscopedMock: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: { connection: { findMany: findManyMock }, vdcPbsNamespace: { findMany: bindingsMock } },
}))
vi.mock('./pbsSnapshots', () => ({ getAllBackups: getAllBackupsMock }))
vi.mock('@/lib/connections/getConnection', () => ({
  getPbsConnectionByIdUnscoped: getPbsConnectionByIdUnscopedMock,
}))

import { buildFleetBackupFreshness, pickForGuest } from './freshness'

function snapshot(over: Partial<any> = {}) {
  return {
    id: 'ds/vm/100/1700000000',
    datastore: 'ds',
    namespace: '',
    backupType: 'vm',
    backupId: '100',
    vmName: '',
    backupTime: 1_700_000_000,
    backupTimeFormatted: '',
    backupTimeIso: new Date(1_700_000_000 * 1000).toISOString(),
    size: 1024,
    sizeFormatted: '1 KB',
    files: [],
    fileCount: 0,
    verification: null,
    verified: true,
    verifiedAt: null,
    protected: false,
    owner: '',
    comment: '',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getPbsConnectionByIdUnscopedMock.mockResolvedValue({ baseUrl: 'https://pbs', apiToken: 'x' })
  bindingsMock.mockResolvedValue([])
})

describe('buildFleetBackupFreshness', () => {
  const guests = [
    { connId: 'pve-1', connectionName: 'PVE One', vmid: '100', type: 'qemu' },
    { connId: 'pve-1', connectionName: 'PVE One', vmid: '300', type: 'lxc' },
    { connId: 'pve-1', connectionName: 'PVE One', vmid: '999', type: 'qemu' },
  ]

  it('computes the age per guest and keeps never-backed-up guests with a null age', async () => {
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'PBS Main' }])
    getAllBackupsMock.mockResolvedValue({
      data: [
        snapshot({ backupType: 'vm', backupId: '100', backupTime: 1_700_000_000, size: 2048 }),
        snapshot({ backupType: 'ct', backupId: '300', backupTime: 1_699_000_000 }),
      ],
      warnings: [],
      fromCache: true,
    })
    const out = await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-1', 'pbs-1']),
      guests,
      nowMs: 1_700_003_600_000,
    })
    const byVmid = Object.fromEntries(out.guests.map(g => [g.vmid, g]))
    expect(byVmid['100'].ageSeconds).toBe(3600)
    expect(byVmid['100'].datastore).toBe('ds')
    expect(byVmid['100'].pbsConnectionId).toBe('pbs-1')
    expect(byVmid['100'].pbsConnectionName).toBe('PBS Main')
    expect(byVmid['100'].sizeBytes).toBe(2048)
    expect(byVmid['100'].verified).toBe(true)
    expect(byVmid['300'].backupType).toBe('ct')
    expect(byVmid['999'].ageSeconds).toBeNull()
    expect(byVmid['999'].latestBackupTime).toBeNull()
    expect(byVmid['999'].datastore).toBeNull()
  })

  it('keeps the most recent point across several PBS servers', async () => {
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'A' }, { id: 'pbs-2', name: 'B' }])
    getAllBackupsMock.mockImplementation(async (id: string) => ({
      data: [snapshot({ backupId: '100', backupTime: id === 'pbs-2' ? 1_700_002_000 : 1_700_000_000 })],
      warnings: [],
      fromCache: true,
    }))
    const out = await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-1', 'pbs-1', 'pbs-2']),
      guests: [guests[0]],
      nowMs: 1_700_002_000_000,
    })
    expect(out.guests[0].pbsConnectionId).toBe('pbs-2')
    expect(out.guests[0].ageSeconds).toBe(0)
  })

  it('D12: forwards nonBlocking to getAllBackups so a scrape never blocks on a cold PBS cache', async () => {
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'A' }])
    getAllBackupsMock.mockResolvedValue({ data: [], warnings: [], fromCache: false })
    await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-1', 'pbs-1']),
      guests,
      nowMs: Date.now(),
      nonBlocking: true,
    })
    expect(getAllBackupsMock).toHaveBeenCalledWith('pbs-1', expect.anything(), 'default', undefined, true)
  })

  it('omits nonBlocking (undefined) for every other caller, unchanged', async () => {
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'A' }])
    getAllBackupsMock.mockResolvedValue({ data: [], warnings: [], fromCache: false })
    await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-1', 'pbs-1']),
      guests,
      nowMs: Date.now(),
    })
    expect(getAllBackupsMock).toHaveBeenCalledWith('pbs-1', expect.anything(), 'default', undefined, undefined)
  })

  it('only queries PBS connections inside the token perimeter', async () => {
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'A' }])
    getAllBackupsMock.mockResolvedValue({ data: [], warnings: [], fromCache: true })
    await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-1']),
      guests,
      nowMs: Date.now(),
    })
    expect(getAllBackupsMock).not.toHaveBeenCalled()
  })

  it('does not credit one backup group to two clusters that reuse the VMID', async () => {
    // PBS groups by type/id only: vm/100 can come from either cluster, so
    // neither may be reported fresh on its strength.
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'A' }])
    getAllBackupsMock.mockResolvedValue({
      data: [snapshot({ backupId: '100', backupTime: 1_700_000_000 })],
      warnings: [],
      fromCache: true,
    })
    const out = await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-1', 'pve-2', 'pbs-1']),
      guests: [
        { connId: 'pve-1', connectionName: 'PVE One', vmid: '100', type: 'qemu' },
        { connId: 'pve-2', connectionName: 'PVE Two', vmid: '100', type: 'qemu' },
        { connId: 'pve-2', connectionName: 'PVE Two', vmid: '300', type: 'lxc' },
      ],
      nowMs: 1_700_003_600_000,
    })
    const [one, two, ct] = out.guests
    expect(one.ageSeconds).toBeNull()
    expect(one.pbsConnectionId).toBeNull()
    expect(two.ageSeconds).toBeNull()
    expect(one.warnings.join(' ')).toContain('PVE Two')
    expect(two.warnings.join(' ')).toContain('PVE One')
    expect(ct.warnings).toEqual([])
  })

  it('credits a snapshot of a vDC-bound namespace to the cluster that writes into it only', async () => {
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'A' }])
    bindingsMock.mockResolvedValue([
      { pbsConnectionId: 'pbs-1', datastore: 'ds', namespace: 'tenant/vdc-prod', vdc: { connectionId: 'pve-1' }, pveStorages: [{ pveConnectionId: 'pve-1' }] },
    ])
    getAllBackupsMock.mockResolvedValue({
      data: [snapshot({ backupId: '100', namespace: 'tenant/vdc-prod', backupTime: 1_700_000_000 })],
      warnings: [],
      fromCache: true,
    })
    const out = await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-1', 'pve-2', 'pbs-1']),
      guests: [
        { connId: 'pve-1', connectionName: 'PVE One', vmid: '100', type: 'qemu' },
        { connId: 'pve-2', connectionName: 'PVE Two', vmid: '100', type: 'qemu' },
      ],
      nowMs: 1_700_003_600_000,
    })
    expect(out.guests[0].ageSeconds).toBe(3600)
    expect(out.guests[0].namespace).toBe('tenant/vdc-prod')
    expect(out.guests[0].warnings).toEqual([])
    expect(out.guests[1].ageSeconds).toBeNull()
    expect(out.guests[1].warnings).toEqual([])
  })

  it("never credits a cluster with another cluster's namespace, even for a VMID it alone uses", async () => {
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'A' }])
    bindingsMock.mockResolvedValue([
      { pbsConnectionId: 'pbs-1', datastore: 'ds', namespace: 'vdc-prod', vdc: { connectionId: 'pve-1' }, pveStorages: [] },
    ])
    getAllBackupsMock.mockResolvedValue({
      data: [snapshot({ backupId: '100', namespace: 'vdc-prod', backupTime: 1_700_000_000 })],
      warnings: [],
      fromCache: true,
    })
    const out = await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-2', 'pbs-1']),
      guests: [{ connId: 'pve-2', connectionName: 'PVE Two', vmid: '100', type: 'qemu' }],
      nowMs: 1_700_003_600_000,
    })
    expect(out.guests[0].ageSeconds).toBeNull()
  })

  it('keeps the newest of an owned and an unowned snapshot for a VMID no other cluster uses', async () => {
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'A' }])
    bindingsMock.mockResolvedValue([
      { pbsConnectionId: 'pbs-1', datastore: 'ds', namespace: 'vdc-prod', vdc: { connectionId: 'pve-1' }, pveStorages: [] },
    ])
    getAllBackupsMock.mockResolvedValue({
      data: [
        snapshot({ backupId: '100', namespace: 'vdc-prod', backupTime: 1_700_000_000 }),
        snapshot({ backupId: '100', namespace: '', backupTime: 1_700_001_000 }),
        snapshot({ backupId: '100', namespace: '', backupTime: 1_699_000_000 }),
      ],
      warnings: [],
      fromCache: true,
    })
    const out = await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-1', 'pbs-1']),
      guests: [{ connId: 'pve-1', connectionName: 'PVE One', vmid: '100', type: 'qemu' }],
      nowMs: 1_700_003_600_000,
    })
    expect(out.guests[0].latestBackupTime).toBe(1_700_001_000)
    expect(out.guests[0].namespace).toBe('')
  })

  it('treats every snapshot as unowned when the bindings cannot be read', async () => {
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'A' }])
    bindingsMock.mockRejectedValue(new Error('db down'))
    getAllBackupsMock.mockResolvedValue({ data: [snapshot({ backupId: '100' })], warnings: [], fromCache: true })
    const out = await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-1', 'pbs-1']),
      guests: [{ connId: 'pve-1', connectionName: 'PVE One', vmid: '100', type: 'qemu' }],
      nowMs: 1_700_003_600_000,
    })
    expect(out.warnings.join(' ')).toContain('db down')
    expect(out.guests[0].ageSeconds).toBe(3600)
  })

  it('does not read the bindings when no PBS is visible', async () => {
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'A' }])
    await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-1']),
      guests: [{ connId: 'pve-1', connectionName: 'PVE One', vmid: '100', type: 'qemu' }],
      nowMs: 1_700_003_600_000,
    })
    expect(bindingsMock).not.toHaveBeenCalled()
  })

  it('still attributes a VMID reused across guest types (vm/100 vs ct/100)', async () => {
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'A' }])
    getAllBackupsMock.mockResolvedValue({
      data: [snapshot({ backupType: 'ct', backupId: '100', backupTime: 1_700_000_000 })],
      warnings: [],
      fromCache: true,
    })
    const out = await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-1', 'pve-2', 'pbs-1']),
      guests: [
        { connId: 'pve-1', connectionName: 'PVE One', vmid: '100', type: 'qemu' },
        { connId: 'pve-2', connectionName: 'PVE Two', vmid: '100', type: 'lxc' },
      ],
      nowMs: 1_700_003_600_000,
    })
    expect(out.guests[0].ageSeconds).toBeNull()
    expect(out.guests[0].warnings).toEqual([])
    expect(out.guests[1].ageSeconds).toBe(3600)
  })

  it('surfaces a PBS failure as a warning instead of failing the aggregation', async () => {
    findManyMock.mockResolvedValue([{ id: 'pbs-1', name: 'A' }])
    getAllBackupsMock.mockRejectedValue(new Error('PBS unreachable'))
    const out = await buildFleetBackupFreshness({
      tenantId: 'default',
      visibleConnectionIds: new Set(['pve-1', 'pbs-1']),
      guests: [guests[0]],
      nowMs: Date.now(),
    })
    expect(out.warnings.join(' ')).toContain('PBS unreachable')
    expect(out.guests[0].ageSeconds).toBeNull()
  })
})

describe('pickForGuest', () => {
  const at = (backupTime: number, owner: string[] | null) => ({
    snapshot: snapshot({ backupTime }) as any,
    pbsId: 'pbs-1',
    pbsName: 'A',
    owner: owner ? new Set(owner) : null,
  })

  it('returns nothing for a group without snapshots', () => {
    expect(pickForGuest(undefined, 'pve-1', false)).toEqual({ hit: undefined, unattributed: false })
  })

  it('flags an unowned snapshot left out because the group id is shared', () => {
    const byOwner = new Map([['', at(1, null)]])
    expect(pickForGuest(byOwner, 'pve-1', true)).toEqual({ hit: undefined, unattributed: true })
  })

  it('prefers the newest eligible snapshot and ignores those owned by other clusters', () => {
    const byOwner = new Map([
      ['pve-2', at(30, ['pve-2'])],
      ['pve-1', at(10, ['pve-1'])],
      ['', at(20, null)],
    ])
    expect(pickForGuest(byOwner, 'pve-1', false).hit?.snapshot.backupTime).toBe(20)
    expect(pickForGuest(byOwner, 'pve-1', true).hit?.snapshot.backupTime).toBe(10)
  })
})
