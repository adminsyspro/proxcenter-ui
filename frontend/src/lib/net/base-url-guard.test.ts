import { describe, expect, it, vi } from "vitest"

import { blockedAddressReason, tenantBaseUrlRefusal } from "./base-url-guard"

const never = vi.fn(async () => {
  throw new Error("resolver must not be called for an IP literal")
})

describe("blockedAddressReason", () => {
  it("names loopback, link-local, unspecified and metadata addresses", () => {
    expect(blockedAddressReason("127.0.0.1")).toMatch(/loopback/)
    expect(blockedAddressReason("127.255.0.9")).toMatch(/loopback/)
    expect(blockedAddressReason("::1")).toMatch(/loopback/)
    expect(blockedAddressReason("[::1]")).toMatch(/loopback/)
    expect(blockedAddressReason("169.254.169.254")).toMatch(/link-local/)
    expect(blockedAddressReason("169.254.1.1")).toMatch(/link-local/)
    expect(blockedAddressReason("fe80::1%eth0")).toMatch(/link-local/)
    expect(blockedAddressReason("FE9A::1")).toMatch(/link-local/)
    expect(blockedAddressReason("0.0.0.0")).toMatch(/unspecified/)
    expect(blockedAddressReason("::")).toMatch(/unspecified/)
    expect(blockedAddressReason("fd00:ec2::254")).toMatch(/metadata/)
  })

  it("sees through IPv4-mapped IPv6 forms", () => {
    expect(blockedAddressReason("::ffff:127.0.0.1")).toMatch(/loopback/)
    expect(blockedAddressReason("::ffff:7f00:1")).toMatch(/loopback/)
    expect(blockedAddressReason("::ffff:a9fe:a9fe")).toMatch(/link-local/)
  })

  it("leaves private and public addresses alone", () => {
    for (const ip of ["10.42.0.101", "172.16.0.5", "192.168.1.1", "100.64.0.1", "203.0.113.10", "fd12::1", "2001:db8::1"]) {
      expect(blockedAddressReason(ip)).toBeNull()
    }
  })
})

describe("tenantBaseUrlRefusal", () => {
  it("accepts a private cluster address and a public one without resolving anything", async () => {
    expect(await tenantBaseUrlRefusal("https://10.42.0.101:8006", never)).toBeNull()
    expect(await tenantBaseUrlRefusal("https://[fd12::1]:8006/", never)).toBeNull()
    expect(await tenantBaseUrlRefusal("203.0.113.10:8006", never)).toBeNull()
    expect(never).not.toHaveBeenCalled()
  })

  it("refuses loopback, link-local, unspecified and metadata literals, with or without a scheme", async () => {
    expect(await tenantBaseUrlRefusal("https://127.0.0.1:8006", never)).toMatch(/loopback/)
    expect(await tenantBaseUrlRefusal("http://[::1]:8080", never)).toMatch(/loopback/)
    expect(await tenantBaseUrlRefusal("169.254.169.254", never)).toMatch(/link-local/)
    expect(await tenantBaseUrlRefusal("https://0.0.0.0:8006", never)).toMatch(/unspecified/)
    expect(await tenantBaseUrlRefusal("https://[::ffff:127.0.0.1]:8006", never)).toMatch(/loopback/)
  })

  it("refuses host names that always mean this machine or a metadata service", async () => {
    expect(await tenantBaseUrlRefusal("https://localhost:8006", never)).toMatch(/loopback/)
    expect(await tenantBaseUrlRefusal("https://LOCALHOST:8006", never)).toMatch(/loopback/)
    expect(await tenantBaseUrlRefusal("https://pve.localhost:8006", never)).toMatch(/loopback/)
    expect(await tenantBaseUrlRefusal("http://metadata.google.internal/", never)).toMatch(/metadata/)
  })

  it("resolves a host name once and judges every address it gets", async () => {
    const resolve = vi.fn(async (host: string) => (host === "pve.example.net" ? ["203.0.113.10", "10.0.0.5"] : ["198.51.100.7", "127.0.0.1"]))
    expect(await tenantBaseUrlRefusal("https://pve.example.net:8006", resolve)).toBeNull()
    expect(await tenantBaseUrlRefusal("https://rebind.example.net:8006", resolve)).toMatch(/resolves to 127\.0\.0\.1, a loopback/)
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(resolve).toHaveBeenCalledWith("pve.example.net")
  })

  it("refuses a host name that does not resolve", async () => {
    const failing = vi.fn(async () => {
      throw new Error("ENOTFOUND")
    })
    expect(await tenantBaseUrlRefusal("https://nowhere.invalid:8006", failing)).toMatch(/does not resolve/)
    expect(await tenantBaseUrlRefusal("https://empty.invalid", vi.fn(async () => []))).toMatch(/does not resolve/)
  })

  it("refuses what is not a URL at all", async () => {
    expect(await tenantBaseUrlRefusal("https://", never)).toMatch(/not a valid URL|has no host/)
    expect(await tenantBaseUrlRefusal("http://exa mple", never)).toMatch(/not a valid URL/)
  })
})
