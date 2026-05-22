import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { xoCreateSnapshot, buildVdiDownloadUrl, buildXoAuthHeader } from "./client"
import type { XoConnectionInfo } from "./client"

describe("xcpng/client", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  const xo: XoConnectionInfo = {
    baseUrl: "https://xo.test",
    authHeader: "Basic dXNlcjpwYXNz",
    insecureTLS: false,
  }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe("buildVdiDownloadUrl", () => {
    it("builds raw download URL by default", () => {
      expect(buildVdiDownloadUrl("https://xo.test", "vdi-1")).toBe(
        "https://xo.test/rest/v0/vdis/vdi-1.raw"
      )
    })

    it("supports vhd format when explicitly requested", () => {
      expect(buildVdiDownloadUrl("https://xo.test", "vdi-1", "vhd")).toBe(
        "https://xo.test/rest/v0/vdis/vdi-1.vhd"
      )
    })

    it("strips a trailing slash from the base URL", () => {
      expect(buildVdiDownloadUrl("https://xo.test/", "vdi-1")).toBe(
        "https://xo.test/rest/v0/vdis/vdi-1.raw"
      )
    })
  })

  describe("buildXoAuthHeader", () => {
    it("builds a Basic auth header from user:password credentials", () => {
      expect(buildXoAuthHeader("user:pass")).toBe("Basic dXNlcjpwYXNz")
    })
  })

  describe("xoCreateSnapshot (xoPost regression coverage)", () => {
    it("parses a JSON body without depending on Content-Type", async () => {
      // Regression: on Node 26 + undici 8.x with a custom dispatcher,
      // res.headers.get('content-type') can return null even when the server
      // sent it. The fix parses the body with JSON.parse + text fallback
      // instead of branching on the header.
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ $id: "snap-uuid-1" }), { status: 200 })
      )

      const result = await xoCreateSnapshot(xo, "vm-uuid", "snap-name")
      expect(result).toBe("snap-uuid-1")
    })

    it("returns the plain-text UUID when XO returns a bare string", async () => {
      const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
      fetchMock.mockResolvedValueOnce(new Response(uuid, { status: 200 }))

      const result = await xoCreateSnapshot(xo, "vm-uuid", "snap-name")
      expect(result).toBe(uuid)
    })

    it("posts to the snapshot endpoint with the right body and helper headers", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("a1b2c3d4-e5f6-7890-abcd-ef1234567890", { status: 200 })
      )

      await xoCreateSnapshot(xo, "vm-source-uuid", "test-snap")

      const [url, opts] = fetchMock.mock.calls[0]
      expect(url).toBe("https://xo.test/rest/v0/vms/vm-source-uuid/actions/snapshot")
      expect((opts as any).method).toBe("POST")
      expect(JSON.parse((opts as any).body)).toEqual({ name: "test-snap" })
      expect((opts as any).headers["Authorization"]).toBe("Basic dXNlcjpwYXNz")
      // Defensive header injected by fetchWithInsecureTLS to defeat
      // brotli/zstd regressions on Node 26 + undici 8.x.
      expect((opts as any).headers["Accept-Encoding"]).toBe("identity")
    })

    it("surfaces the HTTP status and body when XO returns non-2xx", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("not authorized", { status: 401, statusText: "Unauthorized" })
      )

      await expect(xoCreateSnapshot(xo, "vm-uuid", "snap")).rejects.toThrow(
        /XO API POST .* failed: 401 Unauthorized not authorized/
      )
    })
  })
})
