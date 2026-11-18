import type { UIEvent } from 'react'

// A scroll as the menus report it: the native event of a plain container, or
// the container itself when PerfectScrollbar drives it.
export type ScrollSource = HTMLElement | UIEvent<HTMLElement>

export const scrollContainerOf = (source: ScrollSource): HTMLElement | null => {
  if (source instanceof HTMLElement) return source

  return source.target instanceof HTMLElement ? source.target : null
}
