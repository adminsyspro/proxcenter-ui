import { describe, it, expect, vi, afterEach } from "vitest"
import { copyToClipboard } from "./clipboard"

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe("copyToClipboard", () => {
  it("uses the async clipboard API when available", async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    vi.stubGlobal("isSecureContext", true)
    expect(await copyToClipboard("hello")).toBe(true)
    expect(writeText).toHaveBeenCalledWith("hello")
  })

  it("falls back to execCommand when clipboard is unavailable (HTTP/IP)", async () => {
    vi.stubGlobal("navigator", {}) // no .clipboard
    const exec = vi.fn(() => true)
    vi.stubGlobal("document", {
      createElement: () => ({ style: {}, focus() {}, select() {}, setAttribute() {}, value: "" }),
      body: { appendChild() {}, removeChild() {} },
      execCommand: exec,
    })
    expect(await copyToClipboard("hello")).toBe(true)
    expect(exec).toHaveBeenCalledWith("copy")
  })

  it("returns false (never throws) when both paths fail", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("denied") }) } })
    vi.stubGlobal("document", { createElement: () => { throw new Error("no dom") }, body: {} })
    expect(await copyToClipboard("hello")).toBe(false)
  })
})

