// Per period aggregates of the vDC usage history (#902): for each counter, the
// maximum, the average and the last value of the samples in the period. That
// is what an invoice line needs (peak, mean, closing value), and what the
// usage chart plots. Pure functions: the routes load the rows, this shapes them.
//
// Periods are cut in UTC so the same range gives the same lines whatever the
// browser or server time zone.

export const USAGE_COUNTERS = [
  'usedVcpus',
  'usedRamMb',
  'usedStorageMb',
  'usedVms',
  'usedSnapshots',
  'usedBackups',
] as const

export type UsageCounter = (typeof USAGE_COUNTERS)[number]

/** `sample` = no aggregation, one period per sample. */
export const USAGE_BUCKETS = ['sample', 'hour', 'day', 'month'] as const

export type UsageBucket = (typeof USAGE_BUCKETS)[number]

export interface UsageSampleRow {
  sampledAt: Date
  usedVcpus: number
  usedRamMb: number
  usedStorageMb: number
  usedVms: number
  usedSnapshots: number
  usedBackups: number
  usedStorageByStorage: unknown
}

export interface UsageStats {
  max: number
  avg: number
  last: number
}

export interface UsagePeriod {
  periodStart: string
  periodEnd: string
  samples: number
  counters: Record<UsageCounter, UsageStats>
  /** Same statistics per storage id, over the samples that measured it. */
  storages: Record<string, UsageStats>
}

/** Start of the UTC period holding `d`. */
export function periodStartOf(d: Date, bucket: UsageBucket): Date {
  switch (bucket) {
    case 'hour':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()))
    case 'day':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    case 'month':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    default:
      return new Date(d.getTime())
  }
}

/** Exclusive end of the period starting at `start` (the sample itself for `sample`). */
export function periodEndOf(start: Date, bucket: UsageBucket): Date {
  switch (bucket) {
    case 'hour':
      return new Date(start.getTime() + 60 * 60 * 1000)
    case 'day':
      return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1))
    case 'month':
      return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
    default:
      return new Date(start.getTime())
  }
}

function storageMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}

  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }

  return out
}

const round2 = (n: number) => Math.round(n * 100) / 100

class StatsAcc {
  max = -Infinity
  sum = 0
  count = 0
  last = 0

  add(v: number) {
    if (v > this.max) this.max = v
    this.sum += v
    this.count++
    this.last = v
  }

  done(): UsageStats {
    return { max: this.count ? this.max : 0, avg: this.count ? round2(this.sum / this.count) : 0, last: this.last }
  }
}

/** Aggregate samples sorted by `sampledAt` ascending into consecutive periods. */
export function aggregateUsage(rows: UsageSampleRow[], bucket: UsageBucket): UsagePeriod[] {
  const periods: UsagePeriod[] = []
  let key: number | null = null
  let start: Date | null = null
  let samples = 0
  let counters: Record<UsageCounter, StatsAcc> | null = null
  let storages = new Map<string, StatsAcc>()

  const flush = () => {
    if (start === null || counters === null) return
    const doneCounters = Object.fromEntries(USAGE_COUNTERS.map(c => [c, counters![c].done()])) as Record<UsageCounter, UsageStats>
    const doneStorages: Record<string, UsageStats> = {}

    for (const [id, acc] of [...storages.entries()].sort(([a], [b]) => a.localeCompare(b))) doneStorages[id] = acc.done()
    periods.push({
      periodStart: start.toISOString(),
      periodEnd: periodEndOf(start, bucket).toISOString(),
      samples,
      counters: doneCounters,
      storages: doneStorages,
    })
  }

  rows.forEach((row, index) => {
    const at = row.sampledAt instanceof Date ? row.sampledAt : new Date(row.sampledAt)
    const s = periodStartOf(at, bucket)
    // `sample` periods never merge, even two samples stamped the same ms.
    const k = bucket === 'sample' ? index : s.getTime()

    if (k !== key) {
      flush()
      key = k
      start = s
      samples = 0
      counters = Object.fromEntries(USAGE_COUNTERS.map(c => [c, new StatsAcc()])) as Record<UsageCounter, StatsAcc>
      storages = new Map()
    }

    samples++
    for (const c of USAGE_COUNTERS) counters![c].add(Number(row[c]) || 0)
    for (const [id, mb] of Object.entries(storageMap(row.usedStorageByStorage))) {
      let acc = storages.get(id)

      if (!acc) {
        acc = new StatsAcc()
        storages.set(id, acc)
      }
      acc.add(mb)
    }
  })

  flush()

  return periods
}

const CSV_COUNTER_COLUMNS: Array<[UsageCounter, string]> = [
  ['usedVcpus', 'vcpus'],
  ['usedRamMb', 'ram_mb'],
  ['usedStorageMb', 'storage_mb'],
  ['usedVms', 'vms'],
  ['usedSnapshots', 'snapshots'],
  ['usedBackups', 'backups'],
]

/** RFC 4180 quoting, plus a leading quote on what a spreadsheet would run as a formula. */
export function csvCell(value: string | number): string {
  let s = String(value)

  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`

  return s
}

/**
 * One CSV line per period: identity of the vDC, period bounds, sample count,
 * then max / avg / last of each counter, then of each storage seen in the range.
 */
export function usagePeriodsToCsv(vdc: { id: string; name: string }, periods: UsagePeriod[]): string {
  const storageIds = [...new Set(periods.flatMap(p => Object.keys(p.storages)))].sort((a, b) => a.localeCompare(b))
  const stats = ['max', 'avg', 'last'] as const
  const header = [
    'vdc_id',
    'vdc_name',
    'period_start',
    'period_end',
    'samples',
    ...CSV_COUNTER_COLUMNS.flatMap(([, col]) => stats.map(s => `${col}_${s}`)),
    ...storageIds.flatMap(id => stats.map(s => `storage_${id}_mb_${s}`)),
  ]
  const lines = [header.map(csvCell).join(',')]

  for (const p of periods) {
    lines.push(
      [
        vdc.id,
        vdc.name,
        p.periodStart,
        p.periodEnd,
        p.samples,
        ...CSV_COUNTER_COLUMNS.flatMap(([c]) => stats.map(s => p.counters[c][s])),
        ...storageIds.flatMap(id => stats.map(s => (p.storages[id] ? p.storages[id][s] : ''))),
      ]
        .map(v => csvCell(v))
        .join(','),
    )
  }

  return `${lines.join('\r\n')}\r\n`
}
