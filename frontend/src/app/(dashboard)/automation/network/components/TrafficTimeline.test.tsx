import { describe, expect, it } from 'vitest'

import { tickAnchor } from './TrafficTimeline'

describe('tickAnchor', () => {
  it('ends the last time label on the last bucket, where a centred one was cut by the edge of the chart', () => {
    expect([0, 1, 2, 3, 4].map(i => tickAnchor(i, 5))).toEqual(['middle', 'middle', 'middle', 'middle', 'end'])
    expect(tickAnchor(0, 1)).toBe('middle')
  })
})
