import { describe, expect, it } from "vitest"

import { interpretConnectionStatusResponse } from "./connectionStatusResult"

describe("interpretConnectionStatusResponse", () => {
  it("accepts an online connection", () => {
    expect(
      interpretConnectionStatusResponse(
        { ok: true, status: 200 },
        { data: { status: "online" } },
      ),
    ).toEqual({ status: "ok" })
  })

  it("accepts a PVE nodes response", () => {
    expect(
      interpretConnectionStatusResponse(
        { ok: true, status: 200 },
        { data: [{ node: "pve-01", status: "online" }] },
      ),
    ).toEqual({ status: "ok" })
  })

  it("surfaces the warning from an authentication error", () => {
    expect(
      interpretConnectionStatusResponse(
        { ok: true, status: 200 },
        {
          data: {
            status: "auth_error",
            warning: "Invalid credentials or Basic auth not enabled on WinRM",
          },
        },
      ),
    ).toEqual({
      status: "error",
      error: "Invalid credentials or Basic auth not enabled on WinRM",
    })
  })

  it("uses a default message for an authentication error without a warning", () => {
    expect(
      interpretConnectionStatusResponse(
        { ok: true, status: 200 },
        { data: { status: "auth_error" } },
      ),
    ).toEqual({ status: "error", error: "Invalid credentials" })
  })

  it("surfaces the API error for a failed response", () => {
    expect(
      interpretConnectionStatusResponse(
        { ok: false, status: 502 },
        { error: "Hyper-V host unreachable: fetch failed" },
      ),
    ).toEqual({ status: "error", error: "Hyper-V host unreachable: fetch failed" })
  })

  it("falls back to the HTTP status for a failed response without an error", () => {
    expect(interpretConnectionStatusResponse({ ok: false, status: 504 }, {})).toEqual({
      status: "error",
      error: "HTTP 504",
    })
  })
})
