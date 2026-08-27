import { afterEach, describe, expect, it, vi } from "vitest"

import { logHypervFailure, withHypervLog } from "./log"

describe("logHypervFailure", () => {
  afterEach(() => vi.restoreAllMocks())

  it("logs the error message with the connection and host and returns it", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const msg = logHypervFailure("VM listing", "SRVBACKUP3", "192.168.78.230", new Error("WinRM HTTP 401: "))
    expect(msg).toBe("WinRM HTTP 401: ")
    expect(spy).toHaveBeenCalledWith("[hyperv] VM listing failed for SRVBACKUP3 (192.168.78.230): WinRM HTTP 401: ")
  })

  it("stringifies non-Error values", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(logHypervFailure("status probe", "HV", "10.0.0.1", "socket hang up")).toBe("socket hang up")
    expect(logHypervFailure("status probe", "HV", "10.0.0.1", { message: "boom" })).toBe("boom")
  })
})

describe("withHypervLog", () => {
  afterEach(() => vi.restoreAllMocks())

  it("returns the result and stays silent on success", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(withHypervLog("VM listing", "HV", "10.0.0.1", async () => [1, 2])).resolves.toEqual([1, 2])
    expect(spy).not.toHaveBeenCalled()
  })

  it("logs then rethrows the original error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const boom = new Error("operation timed out")
    await expect(withHypervLog("VM lookup 42", "HV", "10.0.0.1", async () => { throw boom })).rejects.toBe(boom)
    expect(spy).toHaveBeenCalledWith("[hyperv] VM lookup 42 failed for HV (10.0.0.1): operation timed out")
  })
})
