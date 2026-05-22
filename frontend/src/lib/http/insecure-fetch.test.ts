import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Agent } from "undici"

import {
  fetchWithInsecureTLS,
  INSECURE_FETCH_HEADERS,
  makeInsecureDispatcher,
} from "./insecure-fetch"

describe("insecure-fetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response("ok"))
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe("INSECURE_FETCH_HEADERS", () => {
    it("exports identity Accept-Encoding to defeat brotli/zstd regressions", () => {
      expect(INSECURE_FETCH_HEADERS).toEqual({ "Accept-Encoding": "identity" })
    })
  })

  describe("fetchWithInsecureTLS", () => {
    it("injects Accept-Encoding: identity by default", async () => {
      await fetchWithInsecureTLS("https://example.test/path")

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, opts] = fetchMock.mock.calls[0]
      expect(url).toBe("https://example.test/path")
      expect((opts as any).headers).toEqual({ "Accept-Encoding": "identity" })
    })

    it("merges caller headers on top of the identity default", async () => {
      await fetchWithInsecureTLS("https://example.test", {
        headers: {
          Authorization: "Bearer xyz",
          "Content-Type": "application/json",
        },
      })

      const [, opts] = fetchMock.mock.calls[0]
      expect((opts as any).headers).toEqual({
        "Accept-Encoding": "identity",
        Authorization: "Bearer xyz",
        "Content-Type": "application/json",
      })
    })

    it("lets the caller override Accept-Encoding if explicitly set (escape hatch)", async () => {
      await fetchWithInsecureTLS("https://example.test", {
        headers: { "Accept-Encoding": "gzip" },
      })

      const [, opts] = fetchMock.mock.calls[0]
      expect((opts as any).headers["Accept-Encoding"]).toBe("gzip")
    })

    it("does not attach a dispatcher when insecureTLS is omitted", async () => {
      await fetchWithInsecureTLS("https://example.test")

      const [, opts] = fetchMock.mock.calls[0]
      expect((opts as any).dispatcher).toBeUndefined()
    })

    it("does not attach a dispatcher when insecureTLS is false", async () => {
      await fetchWithInsecureTLS("https://example.test", { insecureTLS: false })

      const [, opts] = fetchMock.mock.calls[0]
      expect((opts as any).dispatcher).toBeUndefined()
    })

    it("attaches an undici Agent when insecureTLS is true", async () => {
      await fetchWithInsecureTLS("https://example.test", { insecureTLS: true })

      const [, opts] = fetchMock.mock.calls[0]
      expect((opts as any).dispatcher).toBeInstanceOf(Agent)
    })

    it("preserves an externally provided dispatcher instead of creating one", async () => {
      const customAgent = new Agent()

      await fetchWithInsecureTLS("https://example.test", {
        insecureTLS: true,
        dispatcher: customAgent,
      })

      const [, opts] = fetchMock.mock.calls[0]
      expect((opts as any).dispatcher).toBe(customAgent)
    })

    it("forwards method, body, and signal verbatim to fetch", async () => {
      const signal = AbortSignal.timeout(10_000)

      await fetchWithInsecureTLS("https://example.test", {
        method: "POST",
        body: '{"x":1}',
        signal,
      })

      const [, opts] = fetchMock.mock.calls[0]
      expect((opts as any).method).toBe("POST")
      expect((opts as any).body).toBe('{"x":1}')
      expect((opts as any).signal).toBe(signal)
    })

    it("returns the Response object from fetch untouched", async () => {
      const response = new Response("payload", { status: 201 })
      fetchMock.mockResolvedValueOnce(response)

      const result = await fetchWithInsecureTLS("https://example.test")

      expect(result).toBe(response)
    })
  })

  describe("makeInsecureDispatcher", () => {
    it("returns an undici Agent instance", async () => {
      const dispatcher = await makeInsecureDispatcher()
      expect(dispatcher).toBeInstanceOf(Agent)
    })
  })
})
