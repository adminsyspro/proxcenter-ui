/**
 * Shared body of the usage history routes (#902): query parsing, and the
 * JSON and CSV answers read from a real history table.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '../../../__tests__/setup/prisma-test'

import { defaultBucketFor, parseUsageHistoryQuery, usageHistoryResponse } from './http'

const NOW = new Date('2026-10-14T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const q = (s: string) => new URLSearchParams(s)

describe('parseUsageHistoryQuery', () => {
  it('defaults to the last 24 hours of raw samples as JSON', () => {
    expect(parseUsageHistoryQuery(q(''), NOW)).toEqual({
      from: new Date(NOW.getTime() - DAY),
      to: NOW,
      bucket: 'sample',
      format: 'json',
    })
  })

  it('picks the bucket from the span when none is asked', () => {
    expect(defaultBucketFor(DAY)).toBe('sample')
    expect(defaultBucketFor(7 * DAY)).toBe('hour')
    expect(defaultBucketFor(30 * DAY)).toBe('day')
    expect(defaultBucketFor(365 * DAY)).toBe('month')
    expect(parseUsageHistoryQuery(q('from=2026-01-01T00:00:00Z&to=2026-10-01T00:00:00Z&format=csv'), NOW)).toMatchObject({
      bucket: 'month',
      format: 'csv',
    })
  })

  it('rejects malformed ranges, buckets and formats', () => {
    expect(parseUsageHistoryQuery(q('from=yesterday'), NOW)).toEqual({ error: 'from and to must be ISO dates' })
    expect(parseUsageHistoryQuery(q('from=2026-10-14T13:00:00Z'), NOW)).toEqual({ error: 'from must be before to' })
    expect(parseUsageHistoryQuery(q('from=2000-01-01T00:00:00Z'), NOW)).toEqual({ error: 'The range cannot exceed 3660 days' })
    expect(parseUsageHistoryQuery(q('bucket=week'), NOW)).toHaveProperty('error')
    expect(parseUsageHistoryQuery(q('from=2026-08-01T00:00:00Z&bucket=sample'), NOW)).toHaveProperty('error')
    expect(parseUsageHistoryQuery(q('format=xml'), NOW)).toEqual({ error: 'format must be json or csv' })
  })
})

describe('usageHistoryResponse', () => {
  beforeEach(async () => {
    await truncate(['vdc_usage_history', 'settings', 'vdcs', 'provider_connections', 'Connection', 'tenants'])
    const now = new Date()

    await prismaTest.tenant.create({
      data: { id: 'tenant-1', slug: 'tenant-1', name: 'Test', operatingModel: 'iaas', createdAt: now, updatedAt: now },
    })
    await prismaTest.$transaction(async (tx) => {
      await tx.connection.create({ data: { id: 'conn1', tenantId: 'default', name: 'pve', baseUrl: 'https://pve', apiTokenEnc: 'enc' } })
      await tx.providerConnection.create({ data: { connectionId: 'conn1' } })
    })
    await prismaTest.vdc.create({
      data: { id: 'vdc-1', tenantId: 'tenant-1', connectionId: 'conn1', name: 'ACME prod', slug: 'acme', pvePoolName: 'pool' },
    })
    const rows = [
      [NOW.getTime() - 3 * HOUR - 10 * 60_000, 1000],
      [NOW.getTime() - 3 * HOUR - 5 * 60_000, 3000],
      [NOW.getTime() - HOUR - 30 * 60_000, 2000],
      [NOW.getTime() - 3 * DAY, 9999], // outside the 24 h default
    ]

    await prismaTest.vdcUsageSample.createMany({
      data: rows.map(([at, mb], i) => ({
        id: `s${i}`,
        vdcId: 'vdc-1',
        vdcName: 'ACME prod',
        tenantId: 'tenant-1',
        tenantName: 'Test',
        connectionId: 'conn1',
        pvePoolName: 'pool',
        sampledAt: new Date(at),
        usedStorageMb: mb,
        usedVms: 2,
        usedStorageByStorage: { ceph: mb / 2 },
      })),
    })
  })

  it('answers the periods of the range with the sampler settings', async () => {
    const res = await usageHistoryResponse({ id: 'vdc-1', name: 'ACME prod' }, q('bucket=hour'), NOW)
    const { data } = await res.json()

    expect(res.status).toBe(200)
    expect(data).toMatchObject({ vdcId: 'vdc-1', vdcName: 'ACME prod', bucket: 'hour', deleted: false, enabled: true, intervalMinutes: 15, retentionDays: 400 })
    expect(data.lastSampledAt).toBe(new Date(NOW.getTime() - HOUR - 30 * 60_000).toISOString())
    expect(data.periods.map((p: any) => [p.periodStart, p.samples, p.counters.usedStorageMb])).toEqual([
      ['2026-10-14T08:00:00.000Z', 2, { max: 3000, avg: 2000, last: 3000 }],
      ['2026-10-14T10:00:00.000Z', 1, { max: 2000, avg: 2000, last: 2000 }],
    ])
    expect(data.periods[0].storages.ceph).toEqual({ max: 1500, avg: 1000, last: 1500 })
  })

  it('answers a CSV attachment for the same periods', async () => {
    const res = await usageHistoryResponse(
      { id: 'vdc-1', name: 'ACME prod' },
      q('from=2026-10-10T00:00:00Z&to=2026-10-14T12:00:00Z&bucket=day&format=csv'),
      NOW,
    )
    const text = await res.text()

    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="ACME_prod-usage-day-2026-10-10-2026-10-14.csv"')
    const lines = text.trimEnd().split('\r\n')

    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('vdc-1,ACME prod,2026-10-11T00:00:00.000Z,2026-10-12T00:00:00.000Z,1,')
    expect(lines[2]).toContain(',2026-10-14T00:00:00.000Z,2026-10-15T00:00:00.000Z,3,')
  })

  it('flags the answer of a deleted vDC', async () => {
    const res = await usageHistoryResponse({ id: 'vdc-1', name: 'ACME prod' }, q(''), NOW, { deleted: true })

    expect((await res.json()).data.deleted).toBe(true)
  })

  it('answers 400 on a bad query', async () => {
    const res = await usageHistoryResponse({ id: 'vdc-1', name: 'x' }, q('bucket=year'), NOW)

    expect(res.status).toBe(400)
  })
})
