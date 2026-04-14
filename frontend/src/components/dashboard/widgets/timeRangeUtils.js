/**
 * Maps global time range value to API-compatible parameters.
 */
const RANGE_MAP = {
  hour:  { rrdTimeframe: 'hour',  trendsTimeframe: 'hour',  days: 1,  hours: 1 },
  '6h':  { rrdTimeframe: 'day',   trendsTimeframe: 'day',   days: 1,  hours: 6 },
  day:   { rrdTimeframe: 'day',   trendsTimeframe: 'day',   days: 1,  hours: 24 },
  week:  { rrdTimeframe: 'week',  trendsTimeframe: 'week',  days: 7,  hours: 168 },
  month: { rrdTimeframe: 'month', trendsTimeframe: 'month', days: 30, hours: 720 },
}

export function mapTimeRange(range) {
  return RANGE_MAP[range] || RANGE_MAP.hour
}

/**
 * For ranges like "6h", slice data to the last N hours.
 * Expects data points with a `time` field (unix seconds or ms).
 */
/**
 * Format tooltip timestamp from Recharts payload.
 * Shows date + time (e.g. "03/04 14:30").
 */
export function formatTime(payload) {
  const t = payload?.[0]?.payload?.time || payload?.[0]?.payload?.t

  if (!t) return null
  const d = new Date(typeof t === 'number' ? (t > 1e12 ? t : t * 1000) : t)

  if (Number.isNaN(d.getTime())) return t
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')

  
return `${dd}/${mm} ${hh}:${min}`
}

export function sliceToRange(data, range) {
  if (!data?.length) return data
  const { hours } = mapTimeRange(range)


  // Only slice for sub-day ranges on day-resolution data
  if (range !== '6h') return data
  const cutoff = Date.now() / 1000 - hours * 3600

  
return data.filter(p => {
    const t = p.time || p.t

    if (!t) return true
    const ts = t > 1e12 ? t / 1000 : t

    
return ts >= cutoff
  })
}
