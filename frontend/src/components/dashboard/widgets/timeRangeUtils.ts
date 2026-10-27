/**
 * Maps global time range value to API-compatible parameters. `label` is the
 * short form the dashboard's range picker shows for it.
 */
export type TimeRange = 'hour' | '6h' | 'day' | 'week' | 'month'

export interface TimeRangeParams {
  rrdTimeframe: string
  trendsTimeframe: string
  days: number
  hours: number
  label: string
}

/** A chart point as the RRD and trends APIs return it. */
export interface TimedPoint {
  time?: number | string
  t?: number | string
}

const RANGE_MAP: Record<TimeRange, TimeRangeParams> = {
  hour:  { rrdTimeframe: 'hour',  trendsTimeframe: 'hour',  days: 1,  hours: 1,   label: '1h' },
  '6h':  { rrdTimeframe: 'day',   trendsTimeframe: 'day',   days: 1,  hours: 6,   label: '6h' },
  day:   { rrdTimeframe: 'day',   trendsTimeframe: 'day',   days: 1,  hours: 24,  label: '24h' },
  week:  { rrdTimeframe: 'week',  trendsTimeframe: 'week',  days: 7,  hours: 168, label: '7d' },
  month: { rrdTimeframe: 'month', trendsTimeframe: 'month', days: 30, hours: 720, label: '30d' },
}

const isTimeRange = (range: unknown): range is TimeRange =>
  typeof range === 'string' && Object.hasOwn(RANGE_MAP, range)

export function mapTimeRange(range: string | null | undefined): TimeRangeParams {
  return isTimeRange(range) ? RANGE_MAP[range] : RANGE_MAP.hour
}

/**
 * For ranges like "6h", slice data to the last N hours.
 * Expects data points with a `time` field (unix seconds or ms).
 */
/**
 * Format tooltip timestamp from Recharts payload.
 * Shows date + time (e.g. "03/04 14:30").
 */
export function formatTime(payload: ReadonlyArray<{ payload?: TimedPoint }> | null | undefined): string | number | null {
  const t = payload?.[0]?.payload?.time || payload?.[0]?.payload?.t

  if (!t) return null
  // Numbers are unix seconds or milliseconds; anything above 1e12 is already ms.
  const ms = typeof t === 'number' && t <= 1e12 ? t * 1000 : t
  const d = new Date(ms)

  if (Number.isNaN(d.getTime())) return t
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')

  
return `${dd}/${mm} ${hh}:${min}`
}

export function sliceToRange<T extends TimedPoint>(data: T[] | null | undefined, range: string): T[] | null | undefined {
  if (!data?.length) return data
  const { hours } = mapTimeRange(range)


  // Only slice for sub-day ranges on day-resolution data
  if (range !== '6h') return data
  const cutoff = Date.now() / 1000 - hours * 3600

  
return data.filter(p => {
    const t = p.time || p.t

    if (!t) return true
    const n = Number(t)
    const ts = n > 1e12 ? n / 1000 : n

    
return ts >= cutoff
  })
}
