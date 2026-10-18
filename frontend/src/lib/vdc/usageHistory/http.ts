// Shared body of the two usage history routes (#902): the provider route
// (/api/v1/admin/vdcs/{id}/usage/history) and the tenant route
// (/api/v1/vdcs/{id}/usage/history) differ only in who may read which vDC.
//
// Query: from, to (ISO dates, default the last 24 hours), bucket (sample,
// hour, day or month, default picked from the span), format (json or csv).

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'

import {
  aggregateUsage,
  USAGE_BUCKETS,
  usagePeriodsToCsv,
  type UsageBucket,
  type UsagePeriod,
  type UsageSampleRow,
} from './aggregate'
import { loadVdcUsageHistorySettings } from './settings'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const MAX_SPAN_MS = 3660 * DAY_MS
/** Raw samples over a longer span would ship tens of thousands of points. */
const MAX_SAMPLE_SPAN_MS = 31 * DAY_MS

export interface UsageHistoryQuery {
  from: Date
  to: Date
  bucket: UsageBucket
  format: 'json' | 'csv'
}

/** The coarsest bucket that still gives a readable curve over the span. */
export function defaultBucketFor(spanMs: number): UsageBucket {
  if (spanMs <= 2 * DAY_MS) return 'sample'
  if (spanMs <= 14 * DAY_MS) return 'hour'
  if (spanMs <= 92 * DAY_MS) return 'day'

  return 'month'
}

function parseDate(raw: string | null): Date | null | undefined {
  if (raw === null || raw === '') return undefined
  const d = new Date(raw)

  return Number.isNaN(d.getTime()) ? null : d
}

export function parseUsageHistoryQuery(params: URLSearchParams, now: Date): UsageHistoryQuery | { error: string } {
  const to = parseDate(params.get('to'))
  const from = parseDate(params.get('from'))

  if (to === null || from === null) return { error: 'from and to must be ISO dates' }
  const end = to ?? now
  const start = from ?? new Date(end.getTime() - DAY_MS)

  if (start.getTime() >= end.getTime()) return { error: 'from must be before to' }
  const span = end.getTime() - start.getTime()

  if (span > MAX_SPAN_MS) return { error: 'The range cannot exceed 3660 days' }

  const rawBucket = params.get('bucket')

  if (rawBucket && !(USAGE_BUCKETS as readonly string[]).includes(rawBucket)) {
    return { error: `bucket must be one of ${USAGE_BUCKETS.join(', ')}` }
  }
  const bucket = (rawBucket as UsageBucket | null) ?? defaultBucketFor(span)

  if (bucket === 'sample' && span > MAX_SAMPLE_SPAN_MS) {
    return { error: 'Raw samples are limited to 31 days, pick an hour, day or month bucket' }
  }

  const rawFormat = params.get('format') ?? 'json'

  if (rawFormat !== 'json' && rawFormat !== 'csv') return { error: 'format must be json or csv' }

  return { from: start, to: end, bucket, format: rawFormat }
}

export async function loadUsageSamples(vdcId: string, from: Date, to: Date): Promise<UsageSampleRow[]> {
  return prisma.vdcUsageSample.findMany({
    where: { vdcId, sampledAt: { gte: from, lt: to } },
    orderBy: { sampledAt: 'asc' },
    select: {
      sampledAt: true,
      usedVcpus: true,
      usedRamMb: true,
      usedStorageMb: true,
      usedVms: true,
      usedSnapshots: true,
      usedBackups: true,
      usedStorageByStorage: true,
    },
  })
}

export interface UsageHistoryPayload {
  vdcId: string
  vdcName: string
  from: string
  to: string
  bucket: UsageBucket
  /** The vDC is gone; its samples are kept until the retention purges them. */
  deleted: boolean
  enabled: boolean
  intervalMinutes: number
  retentionDays: number
  lastSampledAt: string | null
  periods: UsagePeriod[]
}

function csvFileName(name: string, q: UsageHistoryQuery): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'vdc'
  const day = (d: Date) => d.toISOString().slice(0, 10)

  return `${safe}-usage-${q.bucket}-${day(q.from)}-${day(q.to)}.csv`
}

/** Answer a history request for a vDC (live or deleted) the caller is already allowed to read. */
export async function usageHistoryResponse(
  vdc: { id: string; name: string },
  params: URLSearchParams,
  now: Date = new Date(),
  options: { deleted?: boolean } = {},
): Promise<Response> {
  const q = parseUsageHistoryQuery(params, now)

  if ('error' in q) return NextResponse.json({ error: q.error }, { status: 400 })

  const [rows, settings, last] = await Promise.all([
    loadUsageSamples(vdc.id, q.from, q.to),
    loadVdcUsageHistorySettings(),
    prisma.vdcUsageSample.findFirst({ where: { vdcId: vdc.id }, orderBy: { sampledAt: 'desc' }, select: { sampledAt: true } }),
  ])
  const periods = aggregateUsage(rows, q.bucket)

  if (q.format === 'csv') {
    return new NextResponse(usagePeriodsToCsv(vdc, periods), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFileName(vdc.name, q)}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const payload: UsageHistoryPayload = {
    vdcId: vdc.id,
    vdcName: vdc.name,
    from: q.from.toISOString(),
    to: q.to.toISOString(),
    bucket: q.bucket,
    deleted: !!options.deleted,
    enabled: settings.enabled,
    intervalMinutes: settings.intervalMinutes,
    retentionDays: settings.retentionDays,
    lastSampledAt: last?.sampledAt.toISOString() ?? null,
    periods,
  }

  return NextResponse.json({ data: payload })
}
