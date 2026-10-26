'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/** Distance from the bottom still counted as "parked at the tail", in px. */
export const TAIL_THRESHOLD_PX = 32

interface ScrollMetrics {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

/**
 * Is this scroller parked at the tail?
 *
 * Takes plain metrics so the rule can be asserted without a layout engine:
 * jsdom reports zero for all three on a rendered element.
 */
export function isAtTail(el: ScrollMetrics | null | undefined, threshold = TAIL_THRESHOLD_PX): boolean {
  if (!el) return true

  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}

/**
 * Keep a live log panel on its last line, the way a terminal does (#1201).
 *
 * The panel follows the tail while the reader is parked at it. Scrolling up to
 * read an earlier line pauses the follow, so the view is never yanked back down
 * under the reader; scrolling back to the bottom, or `jumpToTail`, resumes it.
 *
 * `contentKey` changes whenever lines are added (the line count is enough).
 * `resetKey` changes when the panel starts showing another log (another job, a
 * filter): the follow resumes from the tail.
 */
export function useFollowTail<T extends HTMLElement = HTMLDivElement>(contentKey: unknown, resetKey?: unknown) {
  const ref = useRef<T>(null)
  const [following, setFollowing] = useState(true)
  const [prevResetKey, setPrevResetKey] = useState(resetKey)

  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    setFollowing(true)
  }

  // Layout effect: the jump lands before the paint, so a new line never
  // flashes at the old position first.
  useLayoutEffect(() => {
    const el = ref.current

    if (following && el) el.scrollTop = el.scrollHeight
  }, [contentKey, resetKey, following])

  const onScroll = useCallback(() => {
    setFollowing(isAtTail(ref.current))
  }, [])

  const jumpToTail = useCallback(() => {
    const el = ref.current

    if (el) el.scrollTop = el.scrollHeight
    setFollowing(true)
  }, [])

  return { ref, following, onScroll, jumpToTail }
}
