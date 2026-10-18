import { describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ conn: null as any }))
vi.mock("@/lib/tenant", () => ({ getTenantPrisma: vi.fn(() => ({ connection: { findUnique: vi.fn(async () => h.conn) } })) }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "root:pw") }))
const soap = vi.hoisted(() => ({
  soapLogin: vi.fn(async () => ({ s: 1 })), soapLogout: vi.fn(async () => {}),
  soapGetVmConfig: vi.fn(async (_s: any, id: string) => id),
  parseVmConfig: vi.fn((id: string) => {
    if (id === "bad") throw new Error("not found")
    return { disks: [{ capacityBytes: 2 }, { capacityBytes: 3 }] }
  }),
}))
vi.mock("@/lib/vmware/soap", () => soap)
const xapi = vi.hoisted(() => ({
  xapiLogin: vi.fn(async () => ({ x: 1 })), xapiLogout: vi.fn(async () => {}),
  xapiGetVmConfig: vi.fn(async () => ({ disks: [{ sizeBytes: 7 }, { sizeBytes: 0 }] })),
}))
vi.mock("@/lib/xcpng/xapi-client", () => xapi)

import { mapBounded, readBatchDiskSizes } from "./batch-disk-sizes"

describe("mapBounded", () => {
  it("never runs more than `limit` at a time and keeps the order", async () => {
    let live = 0, peak = 0
    const out = await mapBounded([1, 2, 3, 4, 5], 2, Date.now() + 5000, async n => {
      live++; peak = Math.max(peak, live)
      await new Promise(r => setTimeout(r, 5))
      live--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50])
    expect(peak).toBe(2)
  })

  it("gives null to what fails or misses the deadline", async () => {
    const out = await mapBounded(["ok", "boom", "slow"], 3, Date.now() + 30, async s => {
      if (s === "boom") throw new Error("x")
      if (s === "slow") await new Promise(r => setTimeout(r, 200))
      return s
    })
    expect(out).toEqual(["ok", null, null])
    expect(await mapBounded([1], 1, Date.now() - 1, async n => n)).toEqual([null])
  })
})

describe("readBatchDiskSizes", () => {
  it("sums the virtual disks' capacity through vSphere SOAP, null for a VM it cannot read", async () => {
    h.conn = { type: "vmware", subType: "vcenter", baseUrl: "https://vc/", apiTokenEnc: "e", insecureTLS: true }
    const m = await readBatchDiskSizes("default", "vc", ["vm-1", "bad"])
    expect([...m]).toEqual([["vm-1", 5], ["bad", null]])
    expect(soap.soapLogin).toHaveBeenCalledWith("https://vc", "root", "pw", true)
    expect(soap.soapLogout).toHaveBeenCalled()
  })

  it("reads a direct XCP-ng pool through XAPI", async () => {
    h.conn = { type: "xcpng", subType: "xapi", baseUrl: "https://xcp", apiTokenEnc: "e", insecureTLS: true }
    expect([...await readBatchDiskSizes("default", "xcp", ["u1"])]).toEqual([["u1", 7]])
    expect(xapi.xapiLogout).toHaveBeenCalled()
  })

  it.each([
    [{ type: "xcpng", subType: null, baseUrl: "https://xo", apiTokenEnc: "e", insecureTLS: true }],
    [{ type: "hyperv", subType: null, baseUrl: "https://hv", apiTokenEnc: "e", insecureTLS: true }],
    [null],
  ])("has no exact size for a source it cannot read (%#)", async (conn) => {
    h.conn = conn
    expect([...await readBatchDiskSizes("default", "c", ["a", "b"])]).toEqual([["a", null], ["b", null]])
  })

  it("never throws when the source login fails", async () => {
    h.conn = { type: "vmware", subType: null, baseUrl: "https://esxi", apiTokenEnc: "e", insecureTLS: true }
    soap.soapLogin.mockRejectedValueOnce(new Error("ECONNREFUSED"))
    expect([...await readBatchDiskSizes("default", "esxi", ["a"])]).toEqual([["a", null]])
  })
})
