import { describe, expect, it, vi, beforeEach } from 'vitest'

const { findManyMock, getAllBackupsMock, getPbsConnectionByIdUnscopedMock } = vi.hoisted(() => ({
  findManyMock: vi.fn<(args?: any) => Promise<any[]>>(),
  getAllBackupsMock: vi.fn<(...args: any[]) => Promise<any>>(),
  getPbsConnectionByIdUnscopedMock: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findMany: findManyMock } } }))
vi.mock('./pbsSnapshots', () => ({ getAllBackups: getAllBackupsMock }))
vi.mock('@/lib/connections/getConnection', () => ({
  getPbsConnectionByIdUnscoped: getPbsConnectionByIdUnscopedMock,
}))

import { latestPerGuest, buildFleetBackupFreshness } from './freshness'

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
})

describe('latestPerGuest', () => {
  it('keys by backupType/backupId and keeps the most recent point', () => {
    const map = latestPerGuest([
      snapshot({ backupTime: 1_700_000_000 }),
      snapshot({ backupTime: 1_700_009_999 }),
      snapshot({ backupType: 'ct', backupId: '300', backupTime: 1_600_000_000 }),
    ])
    expect(map.size).toBe(2)
    expect(map.get('vm/100')?.backupTime).toBe(1_700_009_999)
    expect(map.get('ct/300')?.backupTime).toBe(1_600_000_000)
  })

  it('handles an empty snapshot list', () => {
    expect(latestPerGuest([]).size).toBe(0)
  })
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
