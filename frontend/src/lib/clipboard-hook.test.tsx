import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useCopyToClipboard } from "./clipboard"

afterEach(() => { vi.restoreAllMocks() })

describe("useCopyToClipboard", () => {
  it("sets copied=true on success and resets after timeout", async () => {
    vi.useFakeTimers()
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })

    const { result } = renderHook(() => useCopyToClipboard(500))
    expect(result.current.copied).toBe(false)

    await act(async () => { await result.current.copy("test") })
    expect(result.current.copied).toBe(true)

    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current.copied).toBe(false)

    vi.useRealTimers()
  })

  it("does not set copied when the copy fails", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error("denied") }) } })
    document.execCommand = vi.fn(() => { throw new Error("no exec") })

    const { result } = renderHook(() => useCopyToClipboard())
    let ok: boolean = true
    await act(async () => { ok = await result.current.copy("test") })
    expect(ok).toBe(false)
    expect(result.current.copied).toBe(false)
  })
})
