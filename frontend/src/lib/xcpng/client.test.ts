import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { xoGetVmConfig, buildVdiDownloadUrl } from "./client"
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
