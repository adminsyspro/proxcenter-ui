/**
 * Component tests for the TasksFooter drag-resize feature (#582).
 *
 * jsdom has no layout engine, but the feature's observable contract is not
 * geometry: it is the --taskbar-height CSS custom property published on
 * document.documentElement, the tasksFooterPanelHeight localStorage key, and
 * the drag-lifecycle side effects on document/body. Every assertion here
 * targets that contract, never internal state.
 *
 * The pure clamp/drag math lives in taskbarHeight.ts and is fully covered by
 * taskbarHeight.test.ts (node project); these tests cover the component
 * wiring: publish effect, drag effect, keyboard handler, persistence effect
 * and the window-resize re-clamp.
 *
 * Data hooks (useTaskEvents / useSharedTasks / useProxCenterTasks) and the
 * DataGrid are mocked following the repo's existing patterns
 * (FeatureGuard.test.tsx, InventoryDialogs.test.tsx) so no network fires and
 * the grid does not dominate the test.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import TasksFooter from './TasksFooter'
import {
  TASKBAR_HEIGHT_VAR,
  TASKBAR_HEADER_HEIGHT,
  TASKBAR_MIN_PANEL_HEIGHT,
  TASKBAR_MAX_PANEL_HEIGHT,
  TASKBAR_DEFAULT_PANEL_HEIGHT,
  TASKBAR_HEIGHT_STORAGE_KEY,
  clampTaskbarPanelHeight,
} from './taskbarHeight'

// ------------------------------------------------------------------ //
// Mocks
// ------------------------------------------------------------------ //

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

vi.mock('@/contexts/ProxCenterTasksContext', () => ({
  useProxCenterTasks: () => ({ tasks: [], clearDone: vi.fn(), restoreTask: vi.fn() }),
}))

vi.mock('@/hooks/useSharedTasks', () => ({
  useSharedTasks: () => ({ data: undefined }),
}))

vi.mock('@/hooks/useTaskEvents', () => ({
  useTaskEvents: () => ({ data: { data: [] }, mutate: vi.fn(), isLoading: false }),
}))

vi.mock('@mui/x-data-grid', () => ({
  DataGrid: () => <div data-testid="datagrid" />,
}))

vi.mock('./TaskDetailDialog', () => ({ default: () => null }))
vi.mock('@/components/SharedTaskDetailDialog', () => ({ default: () => null }))

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

/**
 * Tall enough that the 60%-of-viewport cap (1200px) sits above
 * TASKBAR_MAX_PANEL_HEIGHT, so the plain [MIN, MAX] clamp applies.
 */
const VIEWPORT = 2000

/** Keyboard resize step hardcoded in TasksFooter's handleResizeKeyDown. */
const KEYBOARD_STEP = 24

/** Always strictly inside [MIN, MAX] whatever the constants become. */
const TARGET_PANEL = Math.round((TASKBAR_MIN_PANEL_HEIGHT + TASKBAR_MAX_PANEL_HEIGHT) / 2)

function setViewportHeight(px: number) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: px })
}

function publishedHeight(): string {
  return document.documentElement.style.getPropertyValue(TASKBAR_HEIGHT_VAR)
}

function storedPanelHeight(): string | null {
  return window.localStorage.getItem(TASKBAR_HEIGHT_STORAGE_KEY)
}

function renderExpanded() {
  return render(<TasksFooter defaultExpanded />)
}

function getHandle() {
  return screen.getByRole('separator')
}

/** clientY that panelHeightFromPointer maps to `panel` px for VIEWPORT. */
function pointerYFor(panel: number): number {
  return VIEWPORT - panel - TASKBAR_HEADER_HEIGHT
}

beforeEach(() => {
  window.localStorage.clear()
  setViewportHeight(VIEWPORT)
})

// No automatic RTL cleanup is configured in this repo: unmount explicitly,
// then scrub every global surface the component writes to, so no state leaks
// into the next test.
afterEach(() => {
  cleanup()
  document.documentElement.style.removeProperty(TASKBAR_HEIGHT_VAR)
  document.documentElement.removeAttribute('data-taskbar-resizing')
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  window.localStorage.clear()
})

// ------------------------------------------------------------------ //
// Publish effect
// ------------------------------------------------------------------ //

describe('TasksFooter --taskbar-height publishing', () => {
  it('publishes the header height when collapsed', () => {
    render(<TasksFooter />)
    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT}px`)
  })

  it('publishes header + panel height when expanded', () => {
    renderExpanded()
    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT + TASKBAR_DEFAULT_PANEL_HEIGHT}px`)
  })

  it('publishes 0px when hidden', () => {
    window.localStorage.setItem('tasksFooterHidden', 'true')
    render(<TasksFooter />)
    expect(publishedHeight()).toBe('0px')
  })

  it('removes the property on unmount so the CSS var() fallback applies', () => {
    const { unmount } = renderExpanded()
    expect(publishedHeight()).not.toBe('')
    unmount()
    expect(publishedHeight()).toBe('')
  })
})

// ------------------------------------------------------------------ //
// Handle rendering
// ------------------------------------------------------------------ //

describe('TasksFooter drag handle', () => {
  it('is absent when collapsed', () => {
    render(<TasksFooter />)
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('is present when expanded and exposes the clamp bounds via aria', () => {
    renderExpanded()
    const handle = getHandle()

    expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
    expect(handle).toHaveAttribute('aria-valuenow', String(TASKBAR_DEFAULT_PANEL_HEIGHT))
    expect(handle).toHaveAttribute('aria-valuemin', String(TASKBAR_MIN_PANEL_HEIGHT))
    expect(handle).toHaveAttribute('aria-valuemax', String(TASKBAR_MAX_PANEL_HEIGHT))
  })
})

// ------------------------------------------------------------------ //
// Mouse drag
// ------------------------------------------------------------------ //

describe('TasksFooter mouse drag resize', () => {
  it('resizes with document-level mousemove and keeps the height after release', () => {
    renderExpanded()

    fireEvent.mouseDown(getHandle(), { clientY: pointerYFor(TASKBAR_DEFAULT_PANEL_HEIGHT) })
    fireEvent.mouseMove(document, { clientY: pointerYFor(TARGET_PANEL) })
    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT + TARGET_PANEL}px`)

    fireEvent.mouseUp(document)
    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT + TARGET_PANEL}px`)
  })

  it('locks selection/cursor and flags the drag on <html>, restoring all on release', () => {
    renderExpanded()

    // Pre-existing values must be restored, not blindly cleared.
    document.body.style.userSelect = 'text'
    document.body.style.cursor = 'default'

    fireEvent.mouseDown(getHandle())
    expect(document.documentElement.hasAttribute('data-taskbar-resizing')).toBe(true)
    expect(document.body.style.userSelect).toBe('none')
    expect(document.body.style.cursor).toBe('ns-resize')

    fireEvent.mouseUp(document)
    expect(document.documentElement.hasAttribute('data-taskbar-resizing')).toBe(false)
    expect(document.body.style.userSelect).toBe('text')
    expect(document.body.style.cursor).toBe('default')
  })

  it('does not collapse the panel when the handle is pressed (header toggle must not fire)', () => {
    renderExpanded()
    const expandedHeight = `${TASKBAR_HEADER_HEIGHT + TASKBAR_DEFAULT_PANEL_HEIGHT}px`
    expect(publishedHeight()).toBe(expandedHeight)

    fireEvent.mouseDown(getHandle())
    fireEvent.mouseUp(document)

    expect(screen.getByRole('separator')).toBeInTheDocument()
    expect(publishedHeight()).toBe(expandedHeight)
    expect(window.localStorage.getItem('tasksFooterExpanded')).toBe('true')
  })
})

// ------------------------------------------------------------------ //
// Persistence
// ------------------------------------------------------------------ //

describe('TasksFooter panel height persistence', () => {
  it('writes the height on release only, never mid-drag', () => {
    renderExpanded()

    // The persistence effect runs once on mount with the initial height.
    expect(storedPanelHeight()).toBe(String(TASKBAR_DEFAULT_PANEL_HEIGHT))

    fireEvent.mouseDown(getHandle())
    fireEvent.mouseMove(document, { clientY: pointerYFor(TARGET_PANEL) })

    // Mid-drag: still the pre-drag value, not the live one.
    expect(storedPanelHeight()).toBe(String(TASKBAR_DEFAULT_PANEL_HEIGHT))

    fireEvent.mouseUp(document)
    expect(storedPanelHeight()).toBe(String(TARGET_PANEL))
  })

  it('honours a stored height on mount', () => {
    const stored = TASKBAR_MIN_PANEL_HEIGHT + 30
    window.localStorage.setItem(TASKBAR_HEIGHT_STORAGE_KEY, String(stored))

    renderExpanded()
    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT + stored}px`)
  })

  it('clamps an oversized stored height to the maximum', () => {
    window.localStorage.setItem(TASKBAR_HEIGHT_STORAGE_KEY, String(TASKBAR_MAX_PANEL_HEIGHT * 10))

    renderExpanded()
    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT + TASKBAR_MAX_PANEL_HEIGHT}px`)
  })

  it('clamps an undersized stored height to the minimum', () => {
    window.localStorage.setItem(TASKBAR_HEIGHT_STORAGE_KEY, '1')

    renderExpanded()
    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT + TASKBAR_MIN_PANEL_HEIGHT}px`)
  })
})

// ------------------------------------------------------------------ //
// Keyboard
// ------------------------------------------------------------------ //

describe('TasksFooter keyboard resize', () => {
  it('grows on ArrowUp and shrinks on ArrowDown by one step', () => {
    renderExpanded()
    const handle = getHandle()

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(publishedHeight()).toBe(
      `${TASKBAR_HEADER_HEIGHT + TASKBAR_DEFAULT_PANEL_HEIGHT + KEYBOARD_STEP}px`
    )

    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT + TASKBAR_DEFAULT_PANEL_HEIGHT}px`)
  })

  it('clamps at the maximum', () => {
    window.localStorage.setItem(TASKBAR_HEIGHT_STORAGE_KEY, String(TASKBAR_MAX_PANEL_HEIGHT))
    renderExpanded()

    fireEvent.keyDown(getHandle(), { key: 'ArrowUp' })
    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT + TASKBAR_MAX_PANEL_HEIGHT}px`)
  })

  it('clamps at the minimum', () => {
    window.localStorage.setItem(TASKBAR_HEIGHT_STORAGE_KEY, String(TASKBAR_MIN_PANEL_HEIGHT))
    renderExpanded()

    fireEvent.keyDown(getHandle(), { key: 'ArrowDown' })
    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT + TASKBAR_MIN_PANEL_HEIGHT}px`)
  })

  it('ignores unrelated keys', () => {
    renderExpanded()

    fireEvent.keyDown(getHandle(), { key: 'Enter' })
    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT + TASKBAR_DEFAULT_PANEL_HEIGHT}px`)
  })
})

// ------------------------------------------------------------------ //
// Window resize re-clamp
// ------------------------------------------------------------------ //

describe('TasksFooter window resize re-clamp', () => {
  it('re-clamps the published height when the viewport shrinks (60% cap)', () => {
    window.localStorage.setItem(TASKBAR_HEIGHT_STORAGE_KEY, String(TASKBAR_MAX_PANEL_HEIGHT))
    renderExpanded()
    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT + TASKBAR_MAX_PANEL_HEIGHT}px`)

    const shortViewport = 500
    const reclamped = clampTaskbarPanelHeight(TASKBAR_MAX_PANEL_HEIGHT, shortViewport)
    expect(reclamped).toBeLessThan(TASKBAR_MAX_PANEL_HEIGHT) // the cap actually bites

    setViewportHeight(shortViewport)
    fireEvent(window, new Event('resize'))

    expect(publishedHeight()).toBe(`${TASKBAR_HEADER_HEIGHT + reclamped}px`)
  })
})
