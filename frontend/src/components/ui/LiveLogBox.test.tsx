import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

import LiveLogBox from "./LiveLogBox"
import { isAtTail } from "@/hooks/useFollowTail"

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))

afterEach(cleanup)

const LINE_PX = 20
const VIEW_PX = 100

/**
 * jsdom has no layout: give the scroller the metrics a real browser would, a
 * fixed viewport over a height that grows with the line count.
 */
function withLayout(el: HTMLElement, lines: () => number) {
  let top = 0
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => VIEW_PX })
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => lines() * LINE_PX })
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => { top = Math.max(0, Math.min(v, lines() * LINE_PX - VIEW_PX)) },
  })
}

function setup(initial: number, jumpButton = true) {
  let count = initial
  const ui = (n: number, resetKey = "job-1") => (
    <LiveLogBox lineCount={n} resetKey={resetKey} jumpButton={jumpButton}>
      {Array.from({ length: n }, (_, i) => <div key={i}>line {i}</div>)}
    </LiveLogBox>
  )
  const view = render(ui(count))
  const scroller = screen.getByTestId("live-log-scroller")
  withLayout(scroller, () => count)

  return {
    scroller,
    grow: (n: number, resetKey?: string) => { count = n; view.rerender(ui(n, resetKey)) },
    scrollTo: (top: number) => { scroller.scrollTop = top; fireEvent.scroll(scroller) },
    jumpButton: () => screen.queryByText("common.jumpToLatest"),
  }
}

describe("LiveLogBox", () => {
  it("follows the new lines while the reader sits at the bottom", () => {
    const box = setup(10)

    box.grow(20)
    expect(box.scroller.scrollTop).toBe(20 * LINE_PX - VIEW_PX)
    box.grow(30)
    expect(box.scroller.scrollTop).toBe(30 * LINE_PX - VIEW_PX)
    expect(box.jumpButton()).toBeNull()
  })

  it("stops following once the reader scrolls up, and offers to jump back", () => {
    const box = setup(20)
    box.grow(30)

    box.scrollTo(40)
    box.grow(40)

    expect(box.scroller.scrollTop).toBe(40)
    expect(box.jumpButton()).not.toBeNull()
  })

  it("jumps to the last line and follows again on the button", () => {
    const box = setup(20)
    box.grow(30)
    box.scrollTo(40)

    fireEvent.click(box.jumpButton()!)

    expect(box.scroller.scrollTop).toBe(30 * LINE_PX - VIEW_PX)
    expect(box.jumpButton()).toBeNull()
    box.grow(35)
    expect(box.scroller.scrollTop).toBe(35 * LINE_PX - VIEW_PX)
  })

  it("follows again when the reader scrolls back to the bottom by hand", () => {
    const box = setup(30)
    box.grow(31)
    box.scrollTo(0)

    box.scrollTo(31 * LINE_PX - VIEW_PX)
    box.grow(40)

    expect(box.scroller.scrollTop).toBe(40 * LINE_PX - VIEW_PX)
    expect(box.jumpButton()).toBeNull()
  })

  it("pauses without offering the button where it is turned off", () => {
    const box = setup(20, false)
    box.grow(30)

    box.scrollTo(40)
    box.grow(40)

    expect(box.scroller.scrollTop).toBe(40)
    expect(box.jumpButton()).toBeNull()
  })

  it("starts at the tail again when it shows another log", () => {
    const box = setup(30)
    box.grow(31)
    box.scrollTo(0)

    box.grow(50, "job-2")

    expect(box.scroller.scrollTop).toBe(50 * LINE_PX - VIEW_PX)
    expect(box.jumpButton()).toBeNull()
  })
})

describe("isAtTail", () => {
  it("counts the last few pixels as the tail", () => {
    expect(isAtTail({ scrollHeight: 1000, scrollTop: 680, clientHeight: 300 })).toBe(true)
    expect(isAtTail({ scrollHeight: 1000, scrollTop: 600, clientHeight: 300 })).toBe(false)
  })
})
