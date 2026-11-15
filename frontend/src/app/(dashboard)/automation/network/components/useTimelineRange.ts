import { useCallback, useState } from 'react'

import { DEFAULT_RANGE, asRange, type TimelineRange } from './postureTimeline'

export const RANGE_STORAGE_KEY = 'proxcenter.microseg.postureRange'

function stored(): TimelineRange {
  try {
    return asRange(window.localStorage.getItem(RANGE_STORAGE_KEY))
  } catch {
    // Storage blocked or absent (private window): the default.
    return DEFAULT_RANGE
  }
}

/** The range of the time charts, remembered per browser (a blocked storage only loses the memory, never the chart). */
export function useTimelineRange(): [TimelineRange, (next: TimelineRange) => void] {
  const [range, setRange] = useState<TimelineRange>(stored)
  const choose = useCallback((next: TimelineRange) => {
    setRange(next)
    try {
      window.localStorage.setItem(RANGE_STORAGE_KEY, next)
    } catch {
      // Nothing to remember it in.
    }
  }, [])
  return [range, choose]
}
