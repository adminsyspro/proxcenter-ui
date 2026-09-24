import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const loadRawMock = vi.fn<(...args: any[]) => Promise<any>>()
const allowedPoolsMock = vi.fn<(...args: any[]) => Promise<Set<string> | null>>()
const poolByVmidMock = vi.fn<(...args: any[]) => Promise<Map<number, string>>>()

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { BACKUP_JOB_VIEW: 'backup_job.view' } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id }) }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-x' }))
vi.mock('@/lib/vdc/backupJobs', () => ({
  getAllowedJobPools: allowedPoolsMock,
  // Real semantics needed here: vzdumpRunsTenant's filterBackupRunsForTenant
  // (kept real via the vzdumpRunsTenant mock below) imports this.
  isJobOwnedByTenantPools: (job: { pool?: string | null }, pools: Set<string>) => !!job.pool && pools.has(job.pool),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))
vi.mock('@/lib/backups/vzdumpRunsService', async (orig) => ({
  ...(await orig<typeof import('@/lib/backups/vzdumpRunsService')>()),
  loadBackupRunsRaw: loadRawMock,
  clampDays: (v: unknown) => (v ? Number(v) : 30),
}))
vi.mock('@/lib/backups/vzdumpRunsTenant', async (orig) => ({
  ...(await orig<typeof import('@/lib/backups/vzdumpRunsTenant')>()),
  loadPoolByVmid: poolByVmidMock,
}))

const RAW = {
  jobs: [{ id: 'mine', type: 'vzdump', pool: 'vdc-a', storage: 'pbs' }, { id: 'other', type: 'vzdump', all: 1, storage: 'pbs' }],
  facts: [],
  unreachableNodes: ['pve3'],
  truncatedNodes: ['pve1'],
  since: 0,
  days: 30,
}

async function get(searchParams?: Record<string, string>) {
  const { GET } = await import('./route')
  const res = await callRoute(GET as any, { params: { id: 'conn-1' }, method: 'GET', searchParams })
  return { status: res.status, body: await readJson<any>(res) }
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  loadRawMock.mockReset().mockResolvedValue(RAW)
  allowedPoolsMock.mockReset().mockResolvedValue(null)
  poolByVmidMock.mockReset().mockResolvedValue(new Map())
})

describe('GET /api/v1/connections/[id]/backup-jobs/runs', () => {
  it('checks BACKUP_JOB_VIEW on the connection and returns its denial', async () => {
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const { status } = await get()
    expect(status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('backup_job.view', 'connection', 'conn-1')
    expect(loadRawMock).not.toHaveBeenCalled()
  })

  it('returns the full result to the provider, passing days and noCache', async () => {
    const { status, body } = await get({ days: '7', noCache: '1' })
    expect(status).toBe(200)
    expect(body.data.jobs.map((j: any) => j.jobId)).toEqual(['mine', 'other'])
    expect(body.data.unreachableNodes).toEqual(['pve3'])
    expect(body.data.truncatedNodes).toEqual(['pve1'])
    expect(loadRawMock).toHaveBeenCalledWith({ id: 'conn-1' }, 'conn-1', { days: 7, noCache: true })
  })

  it('filters for a vDC tenant', async () => {
    allowedPoolsMock.mockResolvedValue(new Set(['vdc-a']))
    const { body } = await get()
    expect(body.data.jobs.map((j: any) => j.jobId)).toEqual(['mine'])
    expect(body.data.unreachableNodes).toEqual([])
    expect(body.data.truncatedNodes).toEqual([])
  })

  it('answers 500 with the error message when PVE fails', async () => {
    loadRawMock.mockRejectedValue(new Error('PVE down'))
    const { status, body } = await get()
    expect(status).toBe(500)
    expect(body.error).toBe('PVE down')
  })
})
