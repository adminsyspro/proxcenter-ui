// src/components/broadcast/bannerHeight.ts
//
// Single writer for the --top-banner-height layout contract consumed by
// StyledContentWrapper and StyledHeader. Mirrors how TasksFooter publishes
// --taskbar-height (src/components/TasksFooter.tsx:222-224).

export const TOP_BANNER_HEIGHT_VAR = '--top-banner-height'

/** Above the navbar (1100), below the MUI drawer (1200) and modals (1300). */
export const TOP_BANNER_Z_INDEX = 1150

/** Matches the historical demo-banner row height. */
export const BANNER_ROW_MIN_HEIGHT = 32

interface StyleTarget {
  setProperty(name: string, value: string): void
  removeProperty(name: string): void
}

/**
 * `null` or a non-positive height clears the property rather than writing
 * "0px", so the CSS fallback in `var(--top-banner-height, 0px)` is what
 * applies and the layout is provably untouched with no banner.
 */
export function publishBannerHeight(
  px: number | null,
  target: StyleTarget = document.documentElement.style,
): void {
  if (px === null || px <= 0) {
    target.removeProperty(TOP_BANNER_HEIGHT_VAR)
    return
  }
  target.setProperty(TOP_BANNER_HEIGHT_VAR, `${px}px`)
}
