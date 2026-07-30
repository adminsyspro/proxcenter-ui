// src/components/taskbarHeight.ts
//
// Single writer for the --taskbar-height layout contract consumed by
// StyledMain, the inventory page and the console layouts. Mirrors
// src/components/broadcast/bannerHeight.ts: constants, clamp/drag math and
// the CSS-var writer live here so TasksFooter stays the only publisher and
// the geometry is unit-testable without layout (jsdom cannot measure).

export const TASKBAR_HEIGHT_VAR = '--taskbar-height'

/** Height of the collapsed taskbar header row (px). */
export const TASKBAR_HEADER_HEIGHT = 36

/** Keep a couple of task rows visible even at the smallest size. */
export const TASKBAR_MIN_PANEL_HEIGHT = 120
export const TASKBAR_MAX_PANEL_HEIGHT = 600

/** Historical `maxHeight` prop default, preserves today's appearance. */
export const TASKBAR_DEFAULT_PANEL_HEIGHT = 250

/**
 * A stored/dragged panel must never swallow a short screen: the effective
 * maximum is also capped to this fraction of the viewport height.
 */
const TASKBAR_MAX_VIEWPORT_RATIO = 0.6

/** Sibling of the existing tasksFooterExpanded / tasksFooterHidden keys. */
export const TASKBAR_HEIGHT_STORAGE_KEY = 'tasksFooterPanelHeight'

interface StyleTarget {
  setProperty(name: string, value: string): void
  removeProperty(name: string): void
}

/**
 * Coerces any persisted/derived value into a valid panel height.
 *
 * Non-numeric and non-finite input falls back to the default. The result is
 * clamped into [MIN, MAX], where MAX is additionally capped to 60% of the
 * viewport when a viewport height is supplied. The viewport cap can never
 * drop the upper bound below MIN (tiny viewports must not invert the clamp).
 */
export function clampTaskbarPanelHeight(value: unknown, viewportHeight?: number): number {
  let candidate = Number.NaN

  if (typeof value === 'number') {
    candidate = value
  } else if (typeof value === 'string' && value.trim() !== '') {
    candidate = Number(value)
  }

  if (!Number.isFinite(candidate)) {
    candidate = TASKBAR_DEFAULT_PANEL_HEIGHT
  }

  let max = TASKBAR_MAX_PANEL_HEIGHT

  if (typeof viewportHeight === 'number' && Number.isFinite(viewportHeight)) {
    max = Math.min(max, Math.floor(viewportHeight * TASKBAR_MAX_VIEWPORT_RATIO))
  }

  // Clamp order must not invert: the viewport cap never goes below MIN.
  max = Math.max(max, TASKBAR_MIN_PANEL_HEIGHT)

  return Math.min(max, Math.max(TASKBAR_MIN_PANEL_HEIGHT, Math.round(candidate)))
}

/**
 * Panel height for a drag pointer at `clientY`.
 *
 * The bar is fixed to the viewport bottom and laid out as [header][panel];
 * the drag handle is an absolutely-positioned overlay that adds nothing to
 * the bar's height, so the panel simply fills the space between the pointer
 * and the header. Already clamped against the same viewport.
 */
export function panelHeightFromPointer(clientY: number, viewportHeight: number): number {
  return clampTaskbarPanelHeight(viewportHeight - clientY - TASKBAR_HEADER_HEIGHT, viewportHeight)
}

function resolveStyleTarget(target?: StyleTarget): StyleTarget | null {
  if (target) return target
  if (typeof document === 'undefined') return null

  return document.documentElement.style
}

/**
 * Writes the total bar height (header + panel, 0 when hidden) on the root
 * element. Unlike bannerHeight, 0 is written as "0px" on purpose: that is
 * the value TasksFooter has always published for the hidden state.
 */
export function publishTaskbarHeight(px: number, target?: StyleTarget): void {
  const style = resolveStyleTarget(target)

  if (!style) return
  style.setProperty(TASKBAR_HEIGHT_VAR, `${px}px`)
}

/**
 * Removes the property so the CSS fallback in `var(--taskbar-height, 0px)`
 * applies, used on unmount, like bannerHeight's removeProperty path.
 */
export function clearTaskbarHeight(target?: StyleTarget): void {
  const style = resolveStyleTarget(target)

  if (!style) return
  style.removeProperty(TASKBAR_HEIGHT_VAR)
}

/**
 * Reads the persisted panel height. Returns null when unset, unparsable, or
 * when localStorage is absent/throwing (SSR, private mode); callers fall
 * back to their default and the render never crashes.
 */
export function readStoredPanelHeight(): number | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(TASKBAR_HEIGHT_STORAGE_KEY)

    if (raw === null) return null
    const parsed = Number(raw)

    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Persists the panel height; silently ignores quota/private-mode errors. */
export function storePanelHeight(px: number): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(TASKBAR_HEIGHT_STORAGE_KEY, String(px))
  } catch {
    // Private mode / quota: the height simply stays in memory for the session.
  }
}
