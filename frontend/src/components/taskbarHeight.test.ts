import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TASKBAR_HEIGHT_VAR,
  TASKBAR_HEADER_HEIGHT,
  TASKBAR_MIN_PANEL_HEIGHT,
  TASKBAR_MAX_PANEL_HEIGHT,
  TASKBAR_DEFAULT_PANEL_HEIGHT,
  TASKBAR_HEIGHT_STORAGE_KEY,
  clampTaskbarPanelHeight,
  panelHeightFromPointer,
  publishTaskbarHeight,
  clearTaskbarHeight,
  readStoredPanelHeight,
  storePanelHeight,
} from './taskbarHeight'

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeStyleTarget() {
  return { setProperty: vi.fn(), removeProperty: vi.fn() }
}

function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))

  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    data,
  }
}

describe('constants', () => {
  it('exposes the documented custom property name and header height', () => {
    expect(TASKBAR_HEIGHT_VAR).toBe('--taskbar-height')
    expect(TASKBAR_HEADER_HEIGHT).toBe(36)
  })

  it('keeps the historical 250px default inside the clamp bounds', () => {
    expect(TASKBAR_DEFAULT_PANEL_HEIGHT).toBe(250)
    expect(TASKBAR_DEFAULT_PANEL_HEIGHT).toBeGreaterThanOrEqual(TASKBAR_MIN_PANEL_HEIGHT)
    expect(TASKBAR_DEFAULT_PANEL_HEIGHT).toBeLessThanOrEqual(TASKBAR_MAX_PANEL_HEIGHT)
  })

  it('names the storage key as a sibling of tasksFooterExpanded/Hidden', () => {
    expect(TASKBAR_HEIGHT_STORAGE_KEY).toBe('tasksFooterPanelHeight')
  })
})

describe('clampTaskbarPanelHeight', () => {
  it('falls back to the default for non-numeric and non-finite input', () => {
    expect(clampTaskbarPanelHeight(undefined)).toBe(TASKBAR_DEFAULT_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight(null)).toBe(TASKBAR_DEFAULT_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight('garbage')).toBe(TASKBAR_DEFAULT_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight('')).toBe(TASKBAR_DEFAULT_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight('   ')).toBe(TASKBAR_DEFAULT_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight({})).toBe(TASKBAR_DEFAULT_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight(Number.NaN)).toBe(TASKBAR_DEFAULT_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight(Number.POSITIVE_INFINITY)).toBe(TASKBAR_DEFAULT_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight(Number.NEGATIVE_INFINITY)).toBe(TASKBAR_DEFAULT_PANEL_HEIGHT)
  })

  it('coerces numeric strings (localStorage values)', () => {
    expect(clampTaskbarPanelHeight('300')).toBe(300)
  })

  it('rounds fractional heights', () => {
    expect(clampTaskbarPanelHeight(200.6)).toBe(201)
  })

  it('clamps to MIN for zero and negative input', () => {
    expect(clampTaskbarPanelHeight(0)).toBe(TASKBAR_MIN_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight(-50)).toBe(TASKBAR_MIN_PANEL_HEIGHT)
  })

  it('clamps to MAX for oversized input and is identity within bounds', () => {
    expect(clampTaskbarPanelHeight(10_000)).toBe(TASKBAR_MAX_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight(TASKBAR_MIN_PANEL_HEIGHT)).toBe(TASKBAR_MIN_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight(TASKBAR_MAX_PANEL_HEIGHT)).toBe(TASKBAR_MAX_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight(250)).toBe(250)
  })

  it('caps the maximum to 60% of the viewport when supplied', () => {
    // floor(800 * 0.6) = 480 < 600
    expect(clampTaskbarPanelHeight(TASKBAR_MAX_PANEL_HEIGHT, 800)).toBe(480)
    expect(clampTaskbarPanelHeight(400, 800)).toBe(400)
  })

  it('never lets a tiny viewport push the upper bound below MIN', () => {
    // floor(100 * 0.6) = 60 < MIN, so the cap must not invert the clamp.
    expect(clampTaskbarPanelHeight(TASKBAR_MAX_PANEL_HEIGHT, 100)).toBe(TASKBAR_MIN_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight(50, 100)).toBe(TASKBAR_MIN_PANEL_HEIGHT)
    expect(clampTaskbarPanelHeight(TASKBAR_MAX_PANEL_HEIGHT, 0)).toBe(TASKBAR_MIN_PANEL_HEIGHT)
  })

  it('ignores a non-finite viewport height', () => {
    expect(clampTaskbarPanelHeight(700, Number.NaN)).toBe(TASKBAR_MAX_PANEL_HEIGHT)
  })
})

describe('panelHeightFromPointer', () => {
  // Viewport of 1000px: 60% cap = 600 = TASKBAR_MAX_PANEL_HEIGHT.
  it('grows the panel as the pointer moves toward the top of the viewport', () => {
    expect(panelHeightFromPointer(0, 1000)).toBe(600)
  })

  it('returns viewport - clientY - header in the middle of the viewport', () => {
    expect(panelHeightFromPointer(500, 1000)).toBe(1000 - 500 - TASKBAR_HEADER_HEIGHT)
  })

  it('clamps to MIN when the pointer reaches the bottom of the viewport', () => {
    expect(panelHeightFromPointer(990, 1000)).toBe(TASKBAR_MIN_PANEL_HEIGHT)
    expect(panelHeightFromPointer(1000, 1000)).toBe(TASKBAR_MIN_PANEL_HEIGHT)
  })

  it('applies the viewport cap on shorter screens', () => {
    // floor(900 * 0.6) = 540
    expect(panelHeightFromPointer(100, 900)).toBe(540)
  })
})

describe('publishTaskbarHeight / clearTaskbarHeight', () => {
  it('writes a pixel value on the injected target', () => {
    const target = makeStyleTarget()

    publishTaskbarHeight(286, target)
    expect(target.setProperty).toHaveBeenCalledWith('--taskbar-height', '286px')
  })

  it('writes "0px" for the hidden state instead of clearing (historical contract)', () => {
    const target = makeStyleTarget()

    publishTaskbarHeight(0, target)
    expect(target.setProperty).toHaveBeenCalledWith('--taskbar-height', '0px')
    expect(target.removeProperty).not.toHaveBeenCalled()
  })

  it('clear removes the property so the CSS var() fallback applies', () => {
    const target = makeStyleTarget()

    clearTaskbarHeight(target)
    expect(target.removeProperty).toHaveBeenCalledWith('--taskbar-height')
    expect(target.setProperty).not.toHaveBeenCalled()
  })

  it('publish/clear round-trips on document.documentElement by default', () => {
    const style = makeStyleTarget()

    vi.stubGlobal('document', { documentElement: { style } })

    publishTaskbarHeight(300)
    expect(style.setProperty).toHaveBeenCalledWith('--taskbar-height', '300px')

    clearTaskbarHeight()
    expect(style.removeProperty).toHaveBeenCalledWith('--taskbar-height')
  })

  it('is a no-op without a document (SSR)', () => {
    expect(typeof document).toBe('undefined')
    expect(() => publishTaskbarHeight(300)).not.toThrow()
    expect(() => clearTaskbarHeight()).not.toThrow()
  })
})

describe('readStoredPanelHeight / storePanelHeight', () => {
  it('returns null and does not throw without a window (SSR)', () => {
    expect(typeof window).toBe('undefined')
    expect(readStoredPanelHeight()).toBeNull()
    expect(() => storePanelHeight(300)).not.toThrow()
  })

  it('round-trips a stored height through localStorage', () => {
    const storage = makeStorage()

    vi.stubGlobal('window', { localStorage: storage })

    storePanelHeight(240)
    expect(storage.data.get(TASKBAR_HEIGHT_STORAGE_KEY)).toBe('240')
    expect(readStoredPanelHeight()).toBe(240)
  })

  it('returns null when nothing is stored', () => {
    vi.stubGlobal('window', { localStorage: makeStorage() })
    expect(readStoredPanelHeight()).toBeNull()
  })

  it('returns null for an unparsable stored value', () => {
    vi.stubGlobal('window', {
      localStorage: makeStorage({ [TASKBAR_HEIGHT_STORAGE_KEY]: 'garbage' }),
    })
    expect(readStoredPanelHeight()).toBeNull()
  })

  it('survives a throwing localStorage (private mode, quota)', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {
          throw new Error('quota')
        },
      },
    })

    expect(readStoredPanelHeight()).toBeNull()
    expect(() => storePanelHeight(240)).not.toThrow()
  })
})
