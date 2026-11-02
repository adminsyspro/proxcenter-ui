'use client'

import { useEffect, useState } from 'react'

/** How often the relative times of the micro-segmentation cards move on by themselves. */
export const NOW_REFRESH_MS = 30_000

/**
 * The current time for a render that shows "5 minutes ago" or hides a pause once it is over: refreshed every
 * `intervalMs`, and right after `resetKey` changes (new data in), so the render itself never reads the clock.
 */
export function useNow(intervalMs = NOW_REFRESH_MS, resetKey?: unknown): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, intervalMs)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [intervalMs, resetKey])

  return now
}
