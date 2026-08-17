import { describe, expect, it, vi, beforeEach } from 'vitest'

const findManyMock = vi.fn()
const getSettingMock = vi.fn()

vi.mock('@/lib/db/settings', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}))

vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default',
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    alertSilence: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}))

import { GET } from '../route'

function makeReq(headers: Record<string, string>) {
  return new Request('http://localhost/api/v1/internal/alert-config', { headers })
}

beforeEach(() => {
  findManyMock.mockReset()
  getSettingMock.mockReset()
  process.env.ORCHESTRATOR_API_KEY = 'secret-key'
})

describe('GET /api/v1/internal/alert-config', () => {
  it('returns 401 when X-API-Key is missing', async () => {
    const res = await GET(makeReq({}))
    expect(res.status).toBe(401)
  })

  it('returns 401 when X-API-Key is wrong', async () => {
    const res = await GET(makeReq({ 'X-API-Key': 'nope' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when ORCHESTRATOR_API_KEY env var is empty', async () => {
    process.env.ORCHESTRATOR_API_KEY = ''
    const res = await GET(makeReq({ 'X-API-Key': 'secret-key' }))
    expect(res.status).toBe(401)
  })

  it('returns 200 + payload with valid key', async () => {
    getSettingMock.mockResolvedValueOnce({
      cpu_warning: 80, cpu_critical: 90,
      memory_warning: 90, memory_critical: 95,
      storage_warning: 80, storage_critical: 90,
      snapshot_max_age_days: 7,
    })
    const future = new Date(Date.now() + 60_000)
    findManyMock.mockResolvedValueOnce([
      { fingerprint: 'fp-future', silencedUntil: future },
      { fingerprint: 'fp-indef', silencedUntil: null },
    ])

    const res = await GET(makeReq({ 'X-API-Key': 'secret-key' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.thresholds.memory_warning).toBe(90)
    expect(body.silences).toHaveLength(2)
    expect(body.silences.map((s: { fingerprint: string }) => s.fingerprint)).toEqual(
      expect.arrayContaining(['fp-future', 'fp-indef']),
    )
    expect(body.generated_at).toBeTruthy()
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns default thresholds when no setting stored', async () => {
    getSettingMock.mockResolvedValueOnce(null)
    findManyMock.mockResolvedValueOnce([])

    const res = await GET(makeReq({ 'X-API-Key': 'secret-key' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.thresholds.memory_warning).toBe(80)
    expect(body.thresholds.snapshot_max_age_days).toBe(7)
  })

  it('truncates fractional snapshot_max_age_days to int for the Go decoder', async () => {
    // The Go AlertThresholds struct decodes snapshot_max_age_days as int.
    // A fractional value (which the settings PUT path can persist) would make
    // the configsync JSON decode fail and silently freeze the worker — exactly
    // the silent-stale regression #359 is meant to eliminate.
    getSettingMock.mockResolvedValueOnce({
      memory_warning: 90,
      snapshot_max_age_days: 7.9,
    })
    findManyMock.mockResolvedValueOnce([])

    const res = await GET(makeReq({ 'X-API-Key': 'secret-key' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.thresholds.snapshot_max_age_days).toBe(7)
    expect(Number.isInteger(body.thresholds.snapshot_max_age_days)).toBe(true)
    // Non-int-typed fields stay as-is.
    expect(body.thresholds.memory_warning).toBe(90)
  })

  it('ships the recovery hysteresis to the orchestrator, confirmations as int', async () => {
    // #551: the orchestrator only sends a "resolved" email once the metric has
    // stayed below the margin for N consecutive collections. Dropping these two
    // keys here would silently pin the worker to its own defaults, and a
    // fractional confirmation count would break the whole payload decode.
    getSettingMock.mockResolvedValueOnce({
      recovery_margin: 7.5,
      recovery_confirmations: 4.6,
    })
    findManyMock.mockResolvedValueOnce([])

    const res = await GET(makeReq({ 'X-API-Key': 'secret-key' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.thresholds.recovery_margin).toBe(7.5)
    expect(body.thresholds.recovery_confirmations).toBe(4)
    expect(Number.isInteger(body.thresholds.recovery_confirmations)).toBe(true)
  })

  it('falls back to the default hysteresis when the setting predates it', async () => {
    getSettingMock.mockResolvedValueOnce({ memory_warning: 90 })
    findManyMock.mockResolvedValueOnce([])

    const res = await GET(makeReq({ 'X-API-Key': 'secret-key' }))
    const body = await res.json()
    expect(body.thresholds.recovery_margin).toBe(5)
    expect(body.thresholds.recovery_confirmations).toBe(3)
  })

  it('ships the OSD latency and replication RPO grace to the orchestrator, unrounded', async () => {
    // #721: the Ceph OSD latency and replication RPO checks live in the Go
    // worker, which reads all three as float64. Dropping them here would pin
    // the worker to its own defaults, and truncating them would quietly coarsen
    // a sub-millisecond latency budget into a no-op.
    getSettingMock.mockResolvedValueOnce({
      osd_latency_warning: 12.5,
      osd_latency_critical: 300.5,
      replication_rpo_grace_percent: 12.5,
    })
    findManyMock.mockResolvedValueOnce([])

    const res = await GET(makeReq({ 'X-API-Key': 'secret-key' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.thresholds.osd_latency_warning).toBe(12.5)
    expect(body.thresholds.osd_latency_critical).toBe(300.5)
    expect(body.thresholds.replication_rpo_grace_percent).toBe(12.5)
  })

  it('falls back to the default OSD latency and RPO grace when the setting predates them', async () => {
    getSettingMock.mockResolvedValueOnce({ memory_warning: 90 })
    findManyMock.mockResolvedValueOnce([])

    const res = await GET(makeReq({ 'X-API-Key': 'secret-key' }))
    const body = await res.json()
    expect(body.thresholds.osd_latency_warning).toBe(0)
    expect(body.thresholds.osd_latency_critical).toBe(250)
    expect(body.thresholds.replication_rpo_grace_percent).toBe(25)
  })

  it('preserves an explicit 0 for the disable-the-check convention', async () => {
    // 0 means "check disabled" for both families, exactly like
    // snapshot_max_age_days. A falsy-guarded merge would silently re-enable them.
    getSettingMock.mockResolvedValueOnce({
      osd_latency_warning: 0,
      replication_rpo_grace_percent: 0,
    })
    findManyMock.mockResolvedValueOnce([])

    const res = await GET(makeReq({ 'X-API-Key': 'secret-key' }))
    const body = await res.json()
    expect(body.thresholds.osd_latency_warning).toBe(0)
    expect(body.thresholds.replication_rpo_grace_percent).toBe(0)
  })

  it('honors X-Tenant-ID by scoping the query', async () => {
    getSettingMock.mockResolvedValueOnce({})
    findManyMock.mockResolvedValueOnce([])

    const res = await GET(makeReq({ 'X-API-Key': 'secret-key', 'X-Tenant-ID': 'tenant-B' }))
    expect(res.status).toBe(200)
    expect(getSettingMock).toHaveBeenCalledWith('alert_thresholds', 'tenant-B')
    // Also verify the silences query filtered by tenantId.
    const call = findManyMock.mock.calls[0][0]
    expect(call.where.tenantId).toBe('tenant-B')
  })

  it('filters expired silences server-side', async () => {
    getSettingMock.mockResolvedValueOnce({})
    findManyMock.mockResolvedValueOnce([
      { fingerprint: 'fp-active', silencedUntil: null },
    ])

    const res = await GET(makeReq({ 'X-API-Key': 'secret-key' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    // The `findMany.where` clause should pass an OR filter excluding expired rows;
    // the result here mocks the post-filter list, so we just confirm the contract
    // by verifying the prisma call included the OR clause.
    const call = findManyMock.mock.calls[0][0]
    expect(call.where.OR).toBeDefined()
    expect(call.where.OR.some((c: { silencedUntil: { gt?: Date } | null }) => c.silencedUntil === null)).toBe(true)
    expect(body.silences).toEqual([{ fingerprint: 'fp-active', silenced_until: null }])
  })
})
