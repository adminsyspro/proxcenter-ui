import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { buildVdiDownloadUrl, xoFetch, xoGetVmConfig, xoListHosts, xoListVms } from "./client"
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

  describe("xoFetch", () => {
    it("includes the HTTP status and status text in API errors", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 503, statusText: "Service Unavailable" }))

      await expect(xoFetch(xo, "/hosts")).rejects.toThrow(
        "XO API error: 503 Service Unavailable",
      )
    })
  })

  describe("xoListHosts", () => {
    it("maps hosts returned by the filtered fields URL", async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
        { name_label: "xo-host", address: "10.0.0.30", version: "5.100" },
        { name_label: "old-host", address: "10.0.0.31" },
      ]), { status: 200 }))

      await expect(xoListHosts(xo)).resolves.toEqual([
        { name_label: "xo-host", address: "10.0.0.30", version: "5.100" },
        { name_label: "old-host", address: "10.0.0.31", version: "" },
      ])
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://xo.test/rest/v0/hosts?fields=name_label,address,version",
      )
    })

    it("returns an empty array for a non-array response", async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ hosts: [] }), { status: 200 }))
      await expect(xoListHosts(xo)).resolves.toEqual([])
    })
  })

  describe("xoListVms", () => {
    const filteredUrl = "https://xo.test/rest/v0/vms?fields=uuid,name_label,power_state,CPUs,memory,os_version&filter=type:VM"
    const unfilteredUrl = "https://xo.test/rest/v0/vms?fields=uuid,name_label,power_state,CPUs,memory,os_version"

    it("returns VMs from the filtered URL when supported", async () => {
      const vms = [{ uuid: "vm-1", name_label: "vm-one" }]
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(vms), { status: 200 }))

      await expect(xoListVms(xo)).resolves.toEqual(vms)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(filteredUrl)
    })

    it("falls back to the unfiltered URL when the filtered request fails", async () => {
      const vms = [{ uuid: "vm-2", name_label: "vm-two" }]
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 400, statusText: "Bad Request" }))
        .mockResolvedValueOnce(new Response(JSON.stringify(vms), { status: 200 }))

      await expect(xoListVms(xo)).resolves.toEqual(vms)
      expect(fetchMock.mock.calls.map(call => call[0])).toEqual([filteredUrl, unfilteredUrl])
    })

    it("returns an empty array for a non-array response", async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      await expect(xoListVms(xo)).resolves.toEqual([])
    })
  })

  describe("xoGetVmConfig", () => {
    it("maps the VM VIFs to network entries", async () => {
      // XO answers `VIFs` on /vms/{uuid}; the client used to read only the
      // `$VIFs` spelling, so every migrated VM came back with zero networks.
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            uuid: "vm-1",
            name_label: "vm-one",
            power_state: "Halted",
            $VBDs: [],
            VIFs: ["vif-1"],
          }),
          { status: 200 }
        )
      )
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ device: "0", MAC: "aa:bb", $network: "net-1" }),
          { status: 200 }
        )
      )

      const config = await xoGetVmConfig(xo, "vm-1")

      expect(config.networks).toEqual([{ device: "0", mac: "aa:bb", network: "net-1" }])
      expect(fetchMock.mock.calls[1][0]).toBe("https://xo.test/rest/v0/vifs/vif-1")
    })
  })
})
