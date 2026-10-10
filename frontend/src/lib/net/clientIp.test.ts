import { beforeEach, describe, expect, it, vi } from "vitest"

const findFirstMock = vi.fn()

vi.mock("@/lib/db/prisma", () => ({ prisma: { securityPolicy: { findFirst: findFirstMock } } }))

const {
  clientIpFromHeaders,
  forwardedForOf,
  getTrustedProxies,
  invalidateTrustedProxiesCache,
  resolveClientIp,
} = await import("./clientIp")

beforeEach(() => {
  vi.clearAllMocks()
  invalidateTrustedProxiesCache()
})

describe("resolveClientIp", () => {
  it("with 1 trusted proxy takes the hop our nginx appended, ignoring a forged first hop", () => {
    expect(resolveClientIp("6.6.6.6, 203.0.113.7", 1)).toBe("203.0.113.7")
    expect(resolveClientIp("203.0.113.7", 1)).toBe("203.0.113.7")
  })

  it("with 2 trusted proxies (a load balancer in front of nginx) takes the hop the outer one saw", () => {
    // forged hop, real client (appended by the LB), LB (appended by nginx)
    expect(resolveClientIp("6.6.6.6, 203.0.113.7, 10.0.0.2", 2)).toBe("203.0.113.7")
    expect(resolveClientIp("203.0.113.7, 10.0.0.2", 2)).toBe("203.0.113.7")
  })

  it("is null with fewer hops than trusted proxies", () => {
    expect(resolveClientIp("10.0.0.2", 2)).toBeNull()
  })

  it("is null with 0 trusted proxies: every header is client-controlled", () => {
    expect(resolveClientIp("203.0.113.7", 0)).toBeNull()
  })

  it("is null without the header or with empty hops", () => {
    expect(resolveClientIp(null, 1)).toBeNull()
    expect(resolveClientIp(" , ", 1)).toBeNull()
  })

  it("accepts a repeated header", () => {
    expect(resolveClientIp(["6.6.6.6", "203.0.113.7"], 1)).toBe("203.0.113.7")
  })
})

describe("forwardedForOf", () => {
  it("reads Fetch Headers and the plain object NextAuth passes, never x-real-ip", () => {
    expect(forwardedForOf(new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4")
    expect(forwardedForOf({ "x-forwarded-for": "1.2.3.4" })).toBe("1.2.3.4")
    expect(forwardedForOf(new Headers({ "x-real-ip": "1.2.3.4" }))).toBeNull()
    expect(forwardedForOf(undefined)).toBeNull()
  })
})

describe("getTrustedProxies", () => {
  it("reads the policy once and serves the cached value until invalidated", async () => {
    findFirstMock.mockResolvedValue({ loginTrustedProxies: 2 })
    expect(await getTrustedProxies()).toBe(2)
    expect(await getTrustedProxies()).toBe(2)
    expect(findFirstMock).toHaveBeenCalledTimes(1)

    findFirstMock.mockResolvedValue({ loginTrustedProxies: 0 })
    invalidateTrustedProxiesCache()
    expect(await getTrustedProxies()).toBe(0)
    expect(findFirstMock).toHaveBeenCalledTimes(2)
  })

  it("falls back to 1 (the shipped nginx) without a policy row or on error", async () => {
    findFirstMock.mockResolvedValue(null)
    expect(await getTrustedProxies()).toBe(1)
    invalidateTrustedProxiesCache()
    findFirstMock.mockRejectedValue(new Error("db down"))
    expect(await getTrustedProxies()).toBe(1)
  })

  it("feeds clientIpFromHeaders", async () => {
    findFirstMock.mockResolvedValue({ loginTrustedProxies: 2 })
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" })
    expect(await clientIpFromHeaders(h)).toBe("203.0.113.7")
  })
})
