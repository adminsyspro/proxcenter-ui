import { describe, it, expect } from 'vitest'

import { formatNodeLocalTime } from './nodeTime'

// The Proxmox `/nodes/{node}/time` endpoint returns the real UTC epoch in
// `time` alongside a pre-shifted `localtime` epoch and the node `timezone`.
// The node's wall clock must be rendered from the UTC `time` in the node's OWN
// timezone. Feeding the pre-shifted `localtime` through toLocaleString() made
// the browser add its offset a second time (issue #567: a Europe/Berlin host
// showed UTC+4 instead of UTC+2). `sv-SE` gives a stable `YYYY-MM-DD HH:mm:ss`
// rendering that does not vary across ICU/locale versions.
describe('formatNodeLocalTime', () => {
  it('renders the node wall clock in its timezone during DST (Berlin = UTC+2)', () => {
    const utc = Date.UTC(2024, 6, 1, 12, 0, 0) / 1000 // 2024-07-01T12:00:00Z
    expect(formatNodeLocalTime(utc, 'Europe/Berlin', 'sv-SE')).toBe('2024-07-01 14:00:00')
  })

  it('renders the node wall clock outside DST (Berlin = UTC+1)', () => {
    const utc = Date.UTC(2024, 0, 1, 12, 0, 0) / 1000 // 2024-01-01T12:00:00Z
    expect(formatNodeLocalTime(utc, 'Europe/Berlin', 'sv-SE')).toBe('2024-01-01 13:00:00')
  })

  it('uses the node zone, never the viewer timezone', () => {
    const utc = Date.UTC(2024, 6, 1, 0, 0, 0) / 1000 // 2024-07-01T00:00:00Z
    // Tokyo is UTC+9 year-round -> 09:00 the same day.
    expect(formatNodeLocalTime(utc, 'Asia/Tokyo', 'sv-SE')).toBe('2024-07-01 09:00:00')
  })

  it('falls back to the viewer local time when the zone is unknown (no throw)', () => {
    const utc = Date.UTC(2024, 6, 1, 12, 0, 0) / 1000
    const expected = new Date(utc * 1000).toLocaleString('sv-SE')
    expect(formatNodeLocalTime(utc, 'Not/AZone', 'sv-SE')).toBe(expected)
  })

  it('falls back to the viewer local time when no zone is provided', () => {
    const utc = Date.UTC(2024, 6, 1, 12, 0, 0) / 1000
    const expected = new Date(utc * 1000).toLocaleString('sv-SE')
    expect(formatNodeLocalTime(utc, undefined, 'sv-SE')).toBe(expected)
  })

  it('returns a dash when the timestamp is missing', () => {
    expect(formatNodeLocalTime(undefined, 'Europe/Berlin')).toBe('-')
    expect(formatNodeLocalTime(0, 'Europe/Berlin')).toBe('-')
    expect(formatNodeLocalTime(null, 'Europe/Berlin')).toBe('-')
  })
})
