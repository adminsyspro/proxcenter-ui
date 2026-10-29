import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(), PERMISSIONS: {} }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: vi.fn(), getSessionPrisma: vi.fn() }))
vi.mock('@/lib/tenant/infraScope', () => ({ canMigrateConnections: vi.fn(), getTenantInfrastructureScope: vi.fn() }))

import { batchWithJobs, serializeMigrationJob, type BatchRow } from './batch-access'

const job = (id: string, lines: number, status = 'running') => ({
  id, status, bytesTransferred: BigInt(2048), totalBytes: null,
  logs: Array.from({ length: lines }, (_, i) => ({ ts: `t${i}`, msg: `${id} ${i}`, level: 'info' })),
})

describe('serializeMigrationJob', () => {
  it('turns the counters into numbers and sends the log past the lines asked', () => {
    const out = serializeMigrationJob(job('j1', 3), 2)

    expect(out.bytesTransferred).toBe(2048)
    expect(out.totalBytes).toBeNull()
    expect(out.logs).toEqual([{ ts: 't2', msg: 'j1 2', level: 'info' }])
    expect(out).toMatchObject({ logOffset: 2, logCount: 3 })
  })

  it('sends the whole log, never null, without a count', () => {
    expect(serializeMigrationJob({ ...job('j1', 0), logs: null })).toMatchObject({ logs: [], logOffset: 0, logCount: 0 })
  })
})

describe('batchWithJobs', () => {
  const batch = { id: 'b1' } as BatchRow
  const prismaWith = (jobs: any[]) => ({ migrationJob: { findMany: vi.fn(async () => jobs) } }) as any

  it('sends each job only the lines past the count given for it, in batch order', async () => {
    const prisma = prismaWith([job('j1', 4, 'completed'), job('j2', 2)])
    const out = await batchWithJobs(prisma, batch, [4, 1])

    expect(prisma.migrationJob.findMany).toHaveBeenCalledWith({ where: { batchId: 'b1' }, omit: { config: true }, orderBy: [{ batchOrder: 'asc' }, { createdAt: 'asc' }] })
    expect(out.jobs.map(j => [j.logOffset, j.logs.length, j.logCount])).toEqual([[4, 0, 4], [1, 1, 2]])
    expect(out.counts).toMatchObject({ completed: 1, running: 1 })
  })

  it('sends every log whole when the counts are not one per job', async () => {
    const out = await batchWithJobs(prismaWith([job('j1', 4), job('j2', 2)]), batch, [4])

    expect(out.jobs.map(j => [j.logOffset, j.logs.length])).toEqual([[0, 4], [0, 2]])
  })
})
