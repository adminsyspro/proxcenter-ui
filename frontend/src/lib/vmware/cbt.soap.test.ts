import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock only the network/IO surface; keep real pure helpers (parseDiskCbtFields)
// that the cbt callers compose with.
vi.mock("./soap", async (importActual) => {
  const actual = await importActual<typeof import("./soap")>()
  return { ...actual, soapRequest: vi.fn(), soapGetVmConfig: vi.fn(), extractProp: vi.fn() }
})

import { soapRequest, soapGetVmConfig, extractProp } from "./soap"
import { soapEnableCbt, soapQueryChangedDiskAreas, queryAllChangedAreas, soapGuestShutdown, soapWaitPoweredOff, soapGetSnapshotChangeIds, soapKeepAlive } from "./cbt"

const sr = vi.mocked(soapRequest)
const gvc = vi.mocked(soapGetVmConfig)
const ep = vi.mocked(extractProp)
const session = {
  baseUrl: "https://esxi", cookie: "vmware_soap_session=abc", insecureTLS: true,
  propertyCollector: "pc", sessionManager: "sm", rootFolder: "rf", isVcenter: false,
} as any

beforeEach(() => { sr.mockReset(); gvc.mockReset(); ep.mockReset() })

describe("soapEnableCbt", () => {
  it("issues ReconfigVM_Task with changeTrackingEnabled=true and polls to success", async () => {
    sr.mockResolvedValueOnce({ text: '<returnval type="Task">task-1</returnval>' } as any)
      .mockResolvedValueOnce({ text: '<val xsi:type="TaskInfoState">success</val>' } as any)
    await expect(soapEnableCbt(session, "vm-1")).resolves.toBeUndefined()
    expect(sr.mock.calls[0][1]).toContain("<urn:changeTrackingEnabled>true</urn:changeTrackingEnabled>")
  })
  it("throws on task error", async () => {
    sr.mockResolvedValueOnce({ text: '<returnval type="Task">task-1</returnval>' } as any)
      .mockResolvedValueOnce({ text: '<val>error</val><localizedMessage>boom</localizedMessage>' } as any)
    await expect(soapEnableCbt(session, "vm-1")).rejects.toThrow(/boom/)
  })
})

describe("soapQueryChangedDiskAreas", () => {
  it("sends the deviceKey envelope and parses the covered window", async () => {
    sr.mockResolvedValue({ text: '<returnval><startOffset>0</startOffset><length>1024</length><changedArea><start>0</start><length>512</length></changedArea></returnval>' } as any)
    const r = await soapQueryChangedDiskAreas(session, "vm-1", "snap-1", 2000, 0, "*")
    expect(r).toEqual({ startOffset: 0, length: 1024, extents: [{ offset: 0, length: 512 }] })
    expect(sr.mock.calls[0][1]).toContain("<urn:deviceKey>2000</urn:deviceKey>")
  })
  it("throws on fault", async () => {
    sr.mockResolvedValue({ text: "<faultstring>nope</faultstring>" } as any)
    await expect(soapQueryChangedDiskAreas(session, "vm-1", "snap-1", 2000, 0, "*")).rejects.toThrow(/nope/)
  })
})

describe("queryAllChangedAreas", () => {
  it("pages until the disk capacity is covered, accumulating extents", async () => {
    sr.mockResolvedValueOnce({ text: '<returnval><startOffset>0</startOffset><length>1024</length><changedArea><start>0</start><length>512</length></changedArea></returnval>' } as any)
      .mockResolvedValueOnce({ text: '<returnval><startOffset>1024</startOffset><length>1024</length><changedArea><start>1500</start><length>100</length></changedArea></returnval>' } as any)
    const all = await queryAllChangedAreas(session, "vm-1", "snap-1", 2000, "*", 2048)
    expect(all).toEqual([{ offset: 0, length: 512 }, { offset: 1500, length: 100 }])
    expect(sr).toHaveBeenCalledTimes(2)
  })
})

describe("soapGuestShutdown", () => {
  it("throws when Tools is unavailable (fault)", async () => {
    sr.mockResolvedValue({ text: "<faultstring>no tools</faultstring>" } as any)
    await expect(soapGuestShutdown(session, "vm-1")).rejects.toThrow(/no tools/)
  })
})

describe("soapWaitPoweredOff", () => {
  it("returns true once runtime.powerState is poweredOff", async () => {
    gvc.mockResolvedValue("<xml/>")
    ep.mockReturnValue("poweredOff")
    await expect(soapWaitPoweredOff(session, "vm-1", 10000)).resolves.toBe(true)
  })
})

describe("soapGetSnapshotChangeIds", () => {
  it("retrieves the snapshot device list and maps deviceKey -> changeId", async () => {
    sr.mockResolvedValue({ text: "<irrelevant/>" } as any)
    ep.mockReturnValue(
      `<VirtualDevice xsi:type="VirtualDisk"><key>2000</key><backing><changeId>52 cc/9</changeId></backing></VirtualDevice>`,
    )
    const m = await soapGetSnapshotChangeIds(session, "snapshot-7")
    expect(m.get(2000)).toBe("52 cc/9")
    // queried the snapshot object for its disk backings
    expect(sr.mock.calls[0][1]).toContain("snapshot-7")
  })
})

describe("soapKeepAlive", () => {
  it("sends a CurrentTime ping on the ServiceInstance and passes the session cookie", async () => {
    sr.mockResolvedValue({ text: "<returnval>2026-01-01T00:00:00Z</returnval>" } as any)
    await expect(soapKeepAlive(session)).resolves.toBeUndefined()
    expect(sr.mock.calls[0][1]).toContain("<urn:CurrentTime>")
    expect(sr.mock.calls[0][2]).toBe(session.cookie)
  })

  it("swallows errors so a transient failure never aborts the migration", async () => {
    sr.mockRejectedValue(new Error("boom"))
    await expect(soapKeepAlive(session)).resolves.toBeUndefined()
  })
})
