import { describe, expect, it } from "vitest"

import {
  DEFAULT_EXTERNAL_VM_FETCH_TIMEOUT_MS,
  describeVmLoadFailure,
  describeVmLoadTimeout,
  externalVmFetchTimeoutMs,
} from "./externalVmFetch"

describe("external VM fetch helpers", () => {
  it("allows a longer timeout for Hyper-V", () => {
    expect(externalVmFetchTimeoutMs("hyperv")).toBe(150_000)
  })

  it.each(["vmware", "xcpng", "nutanix", undefined, "unknown"])(
    "uses the default timeout for %s",
    (type) => {
      expect(externalVmFetchTimeoutMs(type)).toBe(DEFAULT_EXTERNAL_VM_FETCH_TIMEOUT_MS)
      expect(externalVmFetchTimeoutMs(type)).toBe(15_000)
    },
  )

  it("includes an API error in the failure description", async () => {
    const res = new Response(JSON.stringify({ error: "WinRM HTTP 401: Access is denied." }), {
      status: 500,
    })

    await expect(describeVmLoadFailure(res)).resolves.toBe(
      "HTTP 500: WinRM HTTP 401: Access is denied.",
    )
  })

  it("falls back to the status for a non-JSON body", async () => {
    const res = new Response("<html>", { status: 502 })

    await expect(describeVmLoadFailure(res)).resolves.toBe("HTTP 502")
  })

  it("falls back to the status when JSON has no string error", async () => {
    const res = new Response(JSON.stringify({ error: null }), { status: 500 })

    await expect(describeVmLoadFailure(res)).resolves.toBe("HTTP 500")
  })

  it.each([
    [150_000, "timeout after 150s"],
    [15_000, "timeout after 15s"],
  ])("describes a %i ms timeout", (timeoutMs, expected) => {
    expect(describeVmLoadTimeout(timeoutMs)).toBe(expected)
  })
})
