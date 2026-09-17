import { describe, expect, it } from 'vitest'

import {
  applyRrdWindow,
  clampRrdWindow,
  clipRrdRows,
  parseRrdWindow,
  presetRangeMeta,
  resolveRrdRequest,
  stepSecondsForTimeframe,
  stepSecondsFromRows,
  timeframeForWindow,
  RRD_MAX_LOOKBACK_SECONDS,
} from './rrdRange'

const NOW = 1_800_000_000

describe('parseRrdWindow', () => {
  it('accepts a pair of epoch seconds', () => {
    expect(parseRrdWindow('1000', '2000')).toEqual({ from: 1000, to: 2000 })
  })

  it('rejects an absent, reversed, empty or non-numeric pair', () => {
    expect(parseRrdWindow(undefined, undefined)).toBeNull()
    expect(parseRrdWindow('2000', '1000')).toBeNull()
    expect(parseRrdWindow('1000', '1000')).toBeNull()
    expect(parseRrdWindow('abc', '2000')).toBeNull()
    expect(parseRrdWindow('', '')).toBeNull()
    expect(parseRrdWindow('-10', '2000')).toBeNull()
  })
})

describe('timeframeForWindow', () => {
  // Every Proxmox archive ends at now, so what decides the archive is how far
  // back the window starts, never how long it is.
  it('takes the finest archive that still reaches the start of the window', () => {
    expect(timeframeForWindow({ from: NOW - 600, to: NOW - 300 }, NOW)).toBe('hour')
    expect(timeframeForWindow({ from: NOW - 7_200, to: NOW - 7_000 }, NOW)).toBe('day')
    expect(timeframeForWindow({ from: NOW - 172_800, to: NOW - 172_000 }, NOW)).toBe('week')
    expect(timeframeForWindow({ from: NOW - 1_209_600, to: NOW - 1_209_000 }, NOW)).toBe('month')
    expect(timeframeForWindow({ from: NOW - 10_000_000, to: NOW - 9_000_000 }, NOW)).toBe('year')
  })

  it('keeps the 60 s archive for a one-minute window inside the last 24 h', () => {
    // The incident-isolation case from the issue: a spike at 19:07 yesterday.
    const from = NOW - 80_000

    expect(timeframeForWindow({ from, to: from + 60 }, NOW)).toBe('day')
    expect(stepSecondsForTimeframe(timeframeForWindow({ from, to: from + 60 }, NOW))).toBe(60)
  })

  it('steps up one archive at the edge, where the shallow one has no point left', () => {
    // `hour` holds 60 points covering 59 minutes, so a window starting exactly
    // an hour ago belongs to the 24 h archive (same 60 s step, more depth).
    expect(timeframeForWindow({ from: NOW - 3_540, to: NOW }, NOW)).toBe('hour')
    expect(timeframeForWindow({ from: NOW - 3_600, to: NOW }, NOW)).toBe('day')
    expect(timeframeForWindow({ from: NOW - 86_400, to: NOW }, NOW)).toBe('week')
  })

  it('falls back to the deepest archive beyond retention', () => {
    expect(timeframeForWindow({ from: NOW - RRD_MAX_LOOKBACK_SECONDS * 3, to: NOW }, NOW)).toBe('year')
  })
})

describe('clampRrdWindow', () => {
  it('leaves a window inside retention untouched', () => {
    const window = { from: NOW - 3_600, to: NOW - 60 }

    expect(clampRrdWindow(window, NOW)).toEqual({ window, truncated: false })
  })

  it('flags and clamps a start older than the deepest archive', () => {
    const result = clampRrdWindow({ from: NOW - RRD_MAX_LOOKBACK_SECONDS - 5_000, to: NOW }, NOW)

    expect(result.truncated).toBe(true)
    expect(result.window.from).toBe(NOW - RRD_MAX_LOOKBACK_SECONDS)
  })

  it('never looks into the future', () => {
    expect(clampRrdWindow({ from: NOW - 600, to: NOW + 86_400 }, NOW).window.to).toBe(NOW)
  })
})

describe('clipRrdRows', () => {
  const rows = [
    { time: 100, cpu: 1 },
    { time: 200, cpu: 2 },
    { time: 300, cpu: 3 },
    { cpu: 4 },
    { time: 0, cpu: 5 },
  ]

  it('keeps the points inside the window, bounds included', () => {
    expect(clipRrdRows(rows, { from: 200, to: 300 })).toEqual([
      { time: 200, cpu: 2 },
      { time: 300, cpu: 3 },
    ])
  })

  it('drops rows without a usable timestamp', () => {
    expect(clipRrdRows(rows, { from: 0, to: 1_000 })).toHaveLength(3)
  })

  it('answers an empty series rather than throwing on junk', () => {
    expect(clipRrdRows(null as any, { from: 0, to: 10 })).toEqual([])
  })
})

describe('stepSecondsFromRows', () => {
  it('reads the real step from the timestamps instead of assuming the table', () => {
    // A PVE 8 node hands back 70 points of 30 min for `day`, not 1440 of 60 s.
    const rows = Array.from({ length: 10 }, (_, i) => ({ time: NOW - (9 - i) * 1_800 }))

    expect(stepSecondsFromRows(rows, 'day')).toBe(1_800)
  })

  it('ignores a single hole in the series', () => {
    const rows = [{ time: 0 }, { time: 60 }, { time: 120 }, { time: 600 }, { time: 660 }]

    expect(stepSecondsFromRows(rows, 'day')).toBe(60)
  })

  it('falls back to the nominal step when there is nothing to measure', () => {
    expect(stepSecondsFromRows([{ time: 10 }], 'year')).toBe(21_600)
    expect(stepSecondsFromRows([], 'week')).toBe(1_800)
  })
})

describe('applyRrdWindow', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ time: NOW - (59 - i) * 60, cpu: i }))

  it('clips and reports what was actually served', () => {
    const { rows: clipped, meta } = applyRrdWindow(rows, { from: NOW - 600, to: NOW }, 'day', false)

    expect(clipped).toHaveLength(11)
    expect(meta).toMatchObject({ timeframe: 'day', stepSeconds: 60, points: 11, truncated: false })
  })

  it('still reports the archive resolution when the window is too short to hold two points', () => {
    const { rows: clipped, meta } = applyRrdWindow(rows, { from: NOW - 30, to: NOW - 5 }, 'day', false)

    expect(clipped).toHaveLength(0)
    expect(meta.points).toBe(0)
    expect(meta.stepSeconds).toBe(60)
  })

  it('carries the truncated flag through', () => {
    expect(applyRrdWindow(rows, { from: NOW - 600, to: NOW }, 'year', true).meta.truncated).toBe(true)
  })
})

describe('presetRangeMeta', () => {
  it('describes a preset answer with the same shape as a windowed one', () => {
    const rows = [{ time: NOW - 120 }, { time: NOW - 60 }, { time: NOW }]

    expect(presetRangeMeta(rows, 'hour')).toEqual({
      timeframe: 'hour',
      stepSeconds: 60,
      from: NOW - 120,
      to: NOW,
      points: 3,
      truncated: false,
    })
  })
})

describe('resolveRrdRequest', () => {
  it('passes a preset through untouched', () => {
    expect(resolveRrdRequest('week', null, null, NOW)).toEqual({ timeframe: 'week', window: null, truncated: false })
  })

  it('defaults an unknown timeframe to the hour', () => {
    expect(resolveRrdRequest('decade', null, null, NOW).timeframe).toBe('hour')
  })

  it('derives the archive from the window when one is given', () => {
    expect(resolveRrdRequest('year', NOW - 600, NOW - 300, NOW)).toEqual({
      timeframe: 'hour',
      window: { from: NOW - 600, to: NOW - 300 },
      truncated: false,
    })
  })

  it('ignores an unusable window rather than failing the request', () => {
    expect(resolveRrdRequest('day', NOW, NOW - 600, NOW).window).toBeNull()
  })
})
