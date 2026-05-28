import { describe, expect, it, vi, beforeEach } from 'vitest'

const getActiveAlertsMock = vi.fn()
const findManyMock = vi.fn()
const isAlertVisibleToTenantMock = vi.fn()

vi.mock('@/lib/orchestrator/client', () => ({
  alertsApi: { getActiveAlerts: (...args: unknown[]) => getActiveAlertsMock(...args) },
}))

vi.mock('@/lib/demo/demo-api', () => ({
  demoResponse: () => null,
}))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: vi.fn().mockResolvedValue('default'),
  getTenantConnectionIds: vi.fn().mockResolvedValue(new Set<string>()),
  getSessionPrisma: vi.fn().mockResolvedValue({
    alertSilence: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  }),
}))

vi.mock('@/lib/vdc/scope', () => ({
  getVdcScope: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { ALERTS_VIEW: 'alerts.view' },
}))

vi.mock('@/lib/alerts/visibility', () => ({
  isAlertVisibleToTenant: (...args: unknown[]) => isAlertVisibleToTenantMock(...args),
}))

vi.mock('@/lib/alerts/vdcVmids', () => ({
  getVdcVmidsByConnection: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from '../route'
import { buildOrchestratorFingerprint } from '@/lib/alerts/orchestratorFingerprint'

function makeReq() {
  return new Request('http://localhost/api/v1/orchestrator/alerts/active')
}

beforeEach(() => {
  getActiveAlertsMock.mockReset()
  findManyMock.mockReset()
  isAlertVisibleToTenantMock.mockReset()
  isAlertVisibleToTenantMock.mockResolvedValue(true)
})

describe('GET /api/v1/orchestrator/alerts/active', () => {
  it('returns alerts unchanged when no silences exist', async () => {
    const alert = {
      connection_id: 'conn-1',
      type: 'memory',
      severity: 'warning',
      resource_type: 'node',
      resource: 'pve-node-1',
    }
    getActiveAlertsMock.mockResolvedValueOnce({ data: [alert] })
    findManyMock.mockResolvedValueOnce([])

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].resource).toBe('pve-node-1')
  })

  it('drops alerts whose fingerprint is silenced', async () => {
    const muted = {
      connection_id: 'conn-1',
      type: 'memory',
      severity: 'warning',
      resource_type: 'node',
      resource: 'pve-node-1',
    }
    const visible = {
      connection_id: 'conn-1',
      type: 'cpu',
      severity: 'warning',
      resource_type: 'node',
      resource: 'pve-node-2',
    }
    const mutedFp = buildOrchestratorFingerprint(muted)
    getActiveAlertsMock.mockResolvedValueOnce({ data: [muted, visible] })
    findManyMock.mockResolvedValueOnce([{ fingerprint: mutedFp }])

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].resource).toBe('pve-node-2')
  })

  it('queries silences with the non-expired OR clause', async () => {
    getActiveAlertsMock.mockResolvedValueOnce({ data: [{ connection_id: 'c', type: 'cpu' }] })
    findManyMock.mockResolvedValueOnce([])

    await GET(makeReq())

    expect(findManyMock).toHaveBeenCalledTimes(1)
    const where = findManyMock.mock.calls[0][0].where
    expect(where.OR).toBeDefined()
    expect(where.OR.some((c: { silencedUntil: unknown }) => c.silencedUntil === null)).toBe(true)
    expect(where.OR.some((c: { silencedUntil: { gt?: Date } }) => c.silencedUntil && (c.silencedUntil as { gt?: Date }).gt instanceof Date)).toBe(true)
  })

  it('skips the silence query when there are no alerts', async () => {
    getActiveAlertsMock.mockResolvedValueOnce({ data: [] })

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([])
    expect(findManyMock).not.toHaveBeenCalled()
  })

  it('tolerates a Prisma error (AlertSilence table missing) by returning visible alerts un-filtered', async () => {
    const alert = { connection_id: 'c', type: 'cpu', severity: 'warning', resource_type: 'node', resource: 'n' }
    getActiveAlertsMock.mockResolvedValueOnce({ data: [alert] })
    findManyMock.mockRejectedValueOnce(new Error('relation "AlertSilence" does not exist'))

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
  })

  it('filters out alerts not visible to the tenant before applying silence filter', async () => {
    const a1 = { connection_id: 'c', type: 'cpu', severity: 'warning', resource_type: 'node', resource: 'n1' }
    const a2 = { connection_id: 'c', type: 'cpu', severity: 'warning', resource_type: 'node', resource: 'n2' }
    getActiveAlertsMock.mockResolvedValueOnce({ data: [a1, a2] })
    // Only a2 is visible to this tenant
    isAlertVisibleToTenantMock.mockImplementation((a: { resource: string }) => Promise.resolve(a.resource === 'n2'))
    findManyMock.mockResolvedValueOnce([])

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].resource).toBe('n2')
  })
})
