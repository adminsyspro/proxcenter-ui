import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// soapWaitForNfcLease polls through soapRequest (same module), so the
// transport is mocked one level lower: undici's request().
const undiciRequest = vi.fn()
vi.mock("undici", () => ({
  request: (...args: any[]) => undiciRequest(...args),
  Agent: class { constructor(_opts?: any) { /* no-op */ } },
}))

import { buildVmdkDownloadUrl, buildVmdkDescriptorUrl, soapWaitForNfcLease } from "./soap"

function reply(text: string) {
  return { statusCode: 200, headers: {}, body: { text: async () => text } }
}

const disk = {
  label: "Hard disk 1", fileName: "[datastore 1] web 01/web 01.vmdk", capacityBytes: 1,
  thinProvisioned: true, datastoreName: "datastore 1", relativePath: "web 01/web 01.vmdk",
} as any

describe("buildVmdkDownloadUrl / buildVmdkDescriptorUrl", () => {
  it.each([
    ["https://esxi-21.lab/sdk", "esxi-21.lab"],
    ["http://10.42.0.21:443/sdk/extra", "10.42.0.21:443"],
    ["esxi-22.lab", "esxi-22.lab"],
  ])("keeps only the host of %s", (base, host) => {
    expect(buildVmdkDownloadUrl(base, disk)).toBe(
      `https://${host}/folder/web%2001/web%2001-flat.vmdk?dcPath=ha-datacenter&dsName=datastore%201`,
    )
    expect(buildVmdkDescriptorUrl(base, disk, "DC 1")).toBe(
      `https://${host}/folder/web%2001/web%2001.vmdk?dcPath=DC%201&dsName=datastore%201`,
    )
  })
})

describe("soapWaitForNfcLease", () => {
  beforeEach(() => { undiciRequest.mockReset(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("rewrites the wildcard host of device URLs to the session host once ready", async () => {
    undiciRequest
      .mockResolvedValueOnce(reply("<propSet><name>state</name><val xsi:type=\"HttpNfcLeaseState\">initializing</val></propSet>"))
      .mockResolvedValueOnce(reply(
        "<propSet><name>state</name><val xsi:type=\"HttpNfcLeaseState\">ready</val></propSet>" +
        "<deviceUrl><key>/vm-42/VirtualLsiLogicController0:0</key><url>https://*/nfc/52ab/disk-0.vmdk</url>" +
        "<fileSize>1073741824</fileSize><disk>true</disk><targetId>disk-0.vmdk</targetId></deviceUrl>",
      ))
    const session = { baseUrl: "https://esxi-21.lab/sdk", cookie: "c", insecureTLS: true, propertyCollector: "ha-property-collector" } as any
    const p = soapWaitForNfcLease(session, "session[52ab]lease")
    await vi.advanceTimersByTimeAsync(4000)
    await expect(p).resolves.toEqual([{
      key: "/vm-42/VirtualLsiLogicController0:0",
      url: "https://esxi-21.lab/nfc/52ab/disk-0.vmdk",
      fileSize: 1073741824, disk: true, targetId: "disk-0.vmdk",
    }])
    expect(undiciRequest).toHaveBeenCalledTimes(2)
  })
})
