import { describe, it, expect, vi, afterEach } from 'vitest'

import { renderHook, act, cleanup } from '@testing-library/react'

import { RRD_MIN_STEP_SECONDS } from '@/lib/metrics/rrdRange'

import useChartDragRange from './useChartDragRange'

afterEach(() => {
  // The suite has no global auto-cleanup, so renders would stack up.
  cleanup()
})

/**
 * Recharts hands its mouse handlers the x value under the cursor as
 * `activeLabel`, an epoch in milliseconds on these charts. Driving the
 * handlers directly is the contract the hook is written against, so the tests
 * need no chart mounted.
 */
const at = (activeLabel?: unknown) => ({ activeLabel } as any)

function setup() {
  const onSelect = vi.fn()
  const view = renderHook(() => useChartDragRange(onSelect))

  return { onSelect, view }
}

describe('useChartDragRange', () => {
  it('starts idle: nothing selected, nothing drawn', () => {
    const { view } = setup()

    expect(view.result.current.dragging).toBe(false)
    expect(view.result.current.selection).toBeNull()
  })

  it('turns a drag into a window in seconds', () => {
    const { onSelect, view } = setup()

    act(() => view.result.current.chartProps.onMouseDown(at(1_000_500)))
    act(() => view.result.current.chartProps.onMouseMove(at(2_000_400)))

    expect(view.result.current.dragging).toBe(true)

    act(() => view.result.current.chartProps.onMouseUp())

    // Floor on the start, ceil on the end, so the drawn window never sits
    // inside what the user swept.
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith({ from: 1_000, to: 2_001 })

    // The drag state is cleared once the window is handed over.
    expect(view.result.current.dragging).toBe(false)
    expect(view.result.current.selection).toBeNull()
  })

  it('reads a backward drag the same way as a forward one', () => {
    const { onSelect, view } = setup()

    act(() => view.result.current.chartProps.onMouseDown(at(2_000_000)))
    act(() => view.result.current.chartProps.onMouseMove(at(1_000_000)))

    // Right to left on screen, left to right on the axis.
    expect(view.result.current.selection?.props.x1).toBe(1_000_000)
    expect(view.result.current.selection?.props.x2).toBe(2_000_000)

    act(() => view.result.current.chartProps.onMouseUp())

    expect(onSelect).toHaveBeenCalledWith({ from: 1_000, to: 2_000 })
  })

  it('widens a drag narrower than the finest archive', () => {
    const { onSelect, view } = setup()

    act(() => view.result.current.chartProps.onMouseDown(at(1_000_000)))
    act(() => view.result.current.chartProps.onMouseMove(at(1_010_000)))
    act(() => view.result.current.chartProps.onMouseUp())

    // 10 s swept, but Proxmox has no second point inside that.
    expect(onSelect).toHaveBeenCalledWith({ from: 1_000, to: 1_000 + RRD_MIN_STEP_SECONDS })
  })

  it('draws the selection only once both bounds are known', () => {
    const { view } = setup()

    act(() => view.result.current.chartProps.onMouseDown(at(1_000_000)))
    expect(view.result.current.selection).toBeNull()

    act(() => view.result.current.chartProps.onMouseMove(at(1_500_000)))

    const selection = view.result.current.selection

    expect(selection).not.toBeNull()
    expect(selection?.props.x1).toBe(1_000_000)
    expect(selection?.props.x2).toBe(1_500_000)
  })

  it('anchors on the first moved-to point when the press carried no label', () => {
    const { onSelect, view } = setup()

    // A press on a chart that just re-rendered under a still cursor: Recharts
    // has no label to give yet.
    act(() => view.result.current.chartProps.onMouseDown(at(undefined)))
    expect(view.result.current.dragging).toBe(false)

    act(() => view.result.current.chartProps.onMouseMove(at(1_000_000)))
    expect(view.result.current.dragging).toBe(true)

    act(() => view.result.current.chartProps.onMouseMove(at(2_000_000)))
    act(() => view.result.current.chartProps.onMouseUp())

    expect(onSelect).toHaveBeenCalledWith({ from: 1_000, to: 2_000 })
  })

  it.each([
    ['no label at all', undefined],
    ['a non-numeric label', 'not-a-time'],
    ['the epoch itself', 0],
    ['a negative epoch', -1_000],
  ])('ignores a press carrying %s', (_label, value) => {
    const { view } = setup()

    act(() => view.result.current.chartProps.onMouseDown(at(value)))

    expect(view.result.current.dragging).toBe(false)
    expect(view.result.current.selection).toBeNull()
  })

  it('ignores a move made without a press', () => {
    const { onSelect, view } = setup()

    act(() => view.result.current.chartProps.onMouseMove(at(1_000_000)))

    expect(view.result.current.dragging).toBe(false)
    expect(view.result.current.selection).toBeNull()

    act(() => view.result.current.chartProps.onMouseUp())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('ignores an unreadable move in the middle of a drag', () => {
    const { onSelect, view } = setup()

    act(() => view.result.current.chartProps.onMouseDown(at(1_000_000)))
    act(() => view.result.current.chartProps.onMouseMove(at(null)))

    // No end point, so the release is a click and not a window.
    expect(view.result.current.selection).toBeNull()

    act(() => view.result.current.chartProps.onMouseUp())

    expect(onSelect).not.toHaveBeenCalled()
    expect(view.result.current.dragging).toBe(false)
  })

  it('treats a release on the press point as a click, not a window', () => {
    const { onSelect, view } = setup()

    act(() => view.result.current.chartProps.onMouseDown(at(1_000_000)))
    act(() => view.result.current.chartProps.onMouseMove(at(1_000_000)))
    act(() => view.result.current.chartProps.onMouseUp())

    expect(onSelect).not.toHaveBeenCalled()
    expect(view.result.current.dragging).toBe(false)
  })

  it('drops the drag when the cursor leaves the chart', () => {
    const { onSelect, view } = setup()

    act(() => view.result.current.chartProps.onMouseDown(at(1_000_000)))
    act(() => view.result.current.chartProps.onMouseMove(at(2_000_000)))
    act(() => view.result.current.chartProps.onMouseLeave())

    expect(onSelect).not.toHaveBeenCalled()
    expect(view.result.current.dragging).toBe(false)
    expect(view.result.current.selection).toBeNull()

    // And the hook is usable again right after.
    act(() => view.result.current.chartProps.onMouseDown(at(3_000_000)))
    act(() => view.result.current.chartProps.onMouseMove(at(4_000_000)))
    act(() => view.result.current.chartProps.onMouseUp())

    expect(onSelect).toHaveBeenCalledWith({ from: 3_000, to: 4_000 })
  })
})
