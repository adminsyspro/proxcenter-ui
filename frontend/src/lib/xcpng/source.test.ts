import { beforeEach, describe, expect, it, vi } from "vitest"

import { decryptSecret } from "@/lib/crypto/secret"
import { getSessionPrisma } from "@/lib/tenant"
import {
  buildVdiDownloadUrl,
  xoFetch,
  xoGetVmConfig,
  xoListHosts,
  xoListVms,
  type XoDiskInfo,
} from "@/lib/xcpng/client"
import {
  xapiGetVmConfig,
  xapiGetVmRecord,
  xapiHosts,
  xapiKeepAlive,
  xapiListVms,
  xapiLogin,
  xapiLogout,
  xapiVdiExportUrl,
  type XapiSession,
} from "@/lib/xcpng/xapi-client"
import {
  openXcpngSource,
  openXcpngSourceWith,
  splitCreds,
  testXcpngConnection,
  xcpngSubTypeOf,
  type XcpngCredentials,
} from "./source"
import { XapiSource } from "./xapi-source"
import { XoSource } from "./xo-source"

vi.mock("@/lib/xcpng/xapi-client", () => ({
  xapiGetVmConfig: vi.fn(),
  xapiGetVmRecord: vi.fn(),
  xapiHosts: vi.fn(),
  xapiKeepAlive: vi.fn(),
  xapiListVms: vi.fn(),
  xapiLogin: vi.fn(),
  xapiLogout: vi.fn(),
  xapiVdiExportUrl: vi.fn(),
}))

vi.mock("@/lib/xcpng/client", () => ({
  buildVdiDownloadUrl: vi.fn(),
  xoFetch: vi.fn(),
  xoGetVmConfig: vi.fn(),
  xoListHosts: vi.fn(),
  xoListVms: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: vi.fn(),
}))

vi.mock("@/lib/crypto/secret", () => ({
  decryptSecret: vi.fn(),
}))

const xapiLoginMock = vi.mocked(xapiLogin)
const xapiLogoutMock = vi.mocked(xapiLogout)
const xapiHostsMock = vi.mocked(xapiHosts)
const xapiGetVmRecordMock = vi.mocked(xapiGetVmRecord)
const xapiKeepAliveMock = vi.mocked(xapiKeepAlive)
const xapiListVmsMock = vi.mocked(xapiListVms)
const xapiVdiExportUrlMock = vi.mocked(xapiVdiExportUrl)
const buildVdiDownloadUrlMock = vi.mocked(buildVdiDownloadUrl)
const xoFetchMock = vi.mocked(xoFetch)
const xoListHostsMock = vi.mocked(xoListHosts)
const xoListVmsMock = vi.mocked(xoListVms)
const getSessionPrismaMock = vi.mocked(getSessionPrisma)
const decryptSecretMock = vi.mocked(decryptSecret)

const session: XapiSession = {
  baseUrl: "https://xcp.test",
  insecureTLS: false,
  ref: "OpaqueRef:session",
}

const xapiCredentials: XcpngCredentials = {
  subType: "xapi",
  baseUrl: "https://xcp.test",
  user: "root",
  password: "secret",
  insecureTLS: false,
}

const disk: XoDiskInfo = {
  vdiUuid: "vdi-uuid",
  vdiRef: "OpaqueRef:vdi",
  label: "disk-0",
  sizeBytes: 1024,
  position: 0,
  srUuid: "sr-uuid",
}

function storedConnection(overrides: Record<string, unknown> = {}) {
  return {
    type: "xcpng",
    subType: "xapi",
    baseUrl: "https://xcp.test",
    apiTokenEnc: "encrypted",
    insecureTLS: false,
    ...overrides,
  }
}

describe("xcpng source helpers", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    xapiLoginMock.mockResolvedValue(session)
    xapiLogoutMock.mockResolvedValue(undefined)
    xapiHostsMock.mockResolvedValue([])
    xapiKeepAliveMock.mockResolvedValue(undefined)
    xapiListVmsMock.mockResolvedValue([])
    xoListHostsMock.mockResolvedValue([])
    xoListVmsMock.mockResolvedValue([])
    xapiVdiExportUrlMock.mockReturnValue("https://xcp.test/export/vdi")
    buildVdiDownloadUrlMock.mockReturnValue("https://xo.test/download/vdi.vhd")
    decryptSecretMock.mockReturnValue("secret")
  })

  describe("xcpngSubTypeOf", () => {
    it("returns xapi only for the xapi subtype", () => {
      expect(xcpngSubTypeOf({ subType: "xapi" })).toBe("xapi")
    })

    it.each(["xo", null, undefined])("returns xo for %s", subType => {
      expect(xcpngSubTypeOf({ subType })).toBe("xo")
    })
  })

  describe("splitCreds", () => {
    it("splits on the first colon and preserves later colons in the password", () => {
      expect(splitCreds("alice:pass:with:colons", "fallback")).toEqual({
        user: "alice",
        password: "pass:with:colons",
      })
    })

    it("uses the default user when the credential has no colon", () => {
      expect(splitCreds("secret", "root")).toEqual({ user: "root", password: "secret" })
    })
  })

  describe("openXcpngSourceWith", () => {
    it("returns an XoSource without logging in through XAPI", async () => {
      const credentials: XcpngCredentials = {
        ...xapiCredentials,
        subType: "xo",
        baseUrl: "https://xo.test",
        user: "admin@admin.net",
      }

      const source = await openXcpngSourceWith(credentials)

      expect(source).toBeInstanceOf(XoSource)
      expect(source.kind).toBe("xo")
      expect(xapiLoginMock).not.toHaveBeenCalled()
    })

    it("logs in with the given credentials and returns an XapiSource", async () => {
      const source = await openXcpngSourceWith(xapiCredentials)

      expect(xapiLoginMock).toHaveBeenCalledWith(
        "https://xcp.test",
        "root",
        "secret",
        false,
      )
      expect(source).toBeInstanceOf(XapiSource)
      expect(source.kind).toBe("xapi")
    })
  })

  describe("openXcpngSource", () => {
    it.each([
      ["a missing connection", null],
      ["a connection of another type", storedConnection({ type: "vmware" })],
    ])("throws for %s", async (_label, connection) => {
      getSessionPrismaMock.mockResolvedValue({
        connection: { findUnique: vi.fn().mockResolvedValue(connection) },
      } as never)

      await expect(openXcpngSource("connection-1")).rejects.toThrow("XCP-ng connection not found")
    })

    it("uses root for a bare direct XAPI password", async () => {
      const findUnique = vi.fn().mockResolvedValue(storedConnection())
      getSessionPrismaMock.mockResolvedValue({ connection: { findUnique } } as never)
      decryptSecretMock.mockReturnValue("bare-password")

      await openXcpngSource("connection-1")

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "connection-1" },
        select: { type: true, subType: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true },
      })
      expect(decryptSecretMock).toHaveBeenCalledWith("encrypted")
      expect(xapiLoginMock).toHaveBeenCalledWith(
        "https://xcp.test",
        "root",
        "bare-password",
        false,
      )
    })

    it("uses admin@admin.net for a bare XO password", async () => {
      const findUnique = vi.fn().mockResolvedValue(storedConnection({
        subType: "xo",
        baseUrl: "https://xo.test/",
        insecureTLS: true,
      }))
      getSessionPrismaMock.mockResolvedValue({ connection: { findUnique } } as never)
      decryptSecretMock.mockReturnValue("bare-password")

      const source = await openXcpngSource("connection-1")
      const result = await source.diskDownload(disk, "vhd")

      expect(result.curlConfig).toContain(
        `header = "Authorization: Basic ${Buffer.from("admin@admin.net:bare-password").toString("base64")}"`,
      )
      expect(xapiLoginMock).not.toHaveBeenCalled()
    })

    it("uses the supplied database client without opening the session database", async () => {
      const findUnique = vi.fn().mockResolvedValue(storedConnection())
      const db = { connection: { findUnique } }

      await openXcpngSource("connection-from-job", db)

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "connection-from-job" },
        select: { type: true, subType: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true },
      })
      expect(getSessionPrismaMock).not.toHaveBeenCalled()
    })
  })

  describe("XoSource inventory", () => {
    const credentials: XcpngCredentials = {
      subType: "xo",
      baseUrl: "https://xo.test/",
      user: "admin@admin.net",
      password: "secret",
      insecureTLS: true,
    }

    it("lists hosts through the XO client with normalized connection details", async () => {
      const hosts = [{ name_label: "host-one", address: "10.0.0.40", version: "5.100" }]
      xoListHostsMock.mockResolvedValue(hosts)
      const source = new XoSource(credentials)

      await expect(source.listHosts()).resolves.toEqual(hosts)
      expect(xoListHostsMock).toHaveBeenCalledWith({
        baseUrl: "https://xo.test",
        authHeader: `Basic ${Buffer.from("admin@admin.net:secret").toString("base64")}`,
        insecureTLS: true,
      })
    })

    it("filters malformed rows and maps VM fields with dynamic memory fallback", async () => {
      xoListVmsMock.mockResolvedValue([
        {
          uuid: "vm-1",
          name_label: "vm-one",
          power_state: "Running",
          CPUs: { number: 2, max: 4 },
          memory: { size: 2147483648 },
          os_version: { name: "Ubuntu" },
        },
        {
          uuid: "vm-2",
          name_label: "vm-two",
          CPUs: { max: 8 },
          memory: { dynamic: [0, 4294967296] },
        },
        null,
        { name_label: "missing uuid" },
        { uuid: "missing-name" },
      ])
      const source = new XoSource(credentials)

      await expect(source.listVms()).resolves.toEqual([
        {
          uuid: "vm-1",
          name_label: "vm-one",
          power_state: "Running",
          CPUs: { number: 2, max: 4 },
          memory: { size: 2147483648 },
          os_version: { name: "Ubuntu" },
        },
        {
          uuid: "vm-2",
          name_label: "vm-two",
          power_state: "Halted",
          CPUs: { number: 0, max: 8 },
          memory: { size: 4294967296 },
          os_version: {},
        },
      ])
      expect(xoListVmsMock).toHaveBeenCalledOnce()
    })

    it("gets a VM through the encoded XO URL", async () => {
      xoFetchMock.mockResolvedValue({ uuid: "vm/one", name_label: "vm-one" })
      const source = new XoSource(credentials)

      await expect(source.getVm("vm/one")).resolves.toEqual({ uuid: "vm/one", name_label: "vm-one" })
      expect(xoFetchMock).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "https://xo.test" }), "/vms/vm%2Fone")
    })
  })

  describe("XapiSource inventory and lifecycle", () => {
    it("delegates VM and host operations to the active XAPI session", async () => {
      const hosts = [{ uuid: "host-1", name_label: "host-one", address: "10.0.0.50", version: "8.3" }]
      const vms = [{
        uuid: "vm-1",
        name_label: "vm-one",
        power_state: "Running",
        CPUs: { number: 2, max: 4 },
        memory: { size: 1024 },
        os_version: {},
      }]
      const vm = { uuid: "vm-1", _ref: "OpaqueRef:vm" }
      xapiHostsMock.mockResolvedValue(hosts)
      xapiListVmsMock.mockResolvedValue(vms)
      xapiGetVmRecordMock.mockResolvedValue(vm)
      const source = await XapiSource.open(xapiCredentials)

      await expect(source.listHosts()).resolves.toEqual(hosts)
      await expect(source.listVms()).resolves.toEqual(vms)
      await expect(source.getVm("vm-1")).resolves.toEqual(vm)
      expect(xapiHostsMock).toHaveBeenCalledWith(session)
      expect(xapiListVmsMock).toHaveBeenCalledWith(session)
      expect(xapiGetVmRecordMock).toHaveBeenCalledWith(session, "vm-1")
    })

    it("keeps the session alive and closes it", async () => {
      const source = await XapiSource.open(xapiCredentials)

      await source.keepAlive()
      await source.close()

      expect(xapiKeepAliveMock).toHaveBeenCalledWith(session)
      expect(xapiLogoutMock).toHaveBeenCalledWith(session)
    })
  })

  describe("XoSource.diskDownload", () => {
    it.each([
      [false, false],
      [true, true],
    ])("includes insecure=%s only when configured", async (insecureTLS, hasInsecureLine) => {
      const source = new XoSource({
        subType: "xo",
        baseUrl: "https://xo.test/",
        user: "alice",
        password: "p:a:ss",
        insecureTLS,
      })

      const result = await source.diskDownload(disk, "vhd")

      expect(buildVdiDownloadUrlMock).toHaveBeenCalledWith("https://xo.test", "vdi-uuid", "vhd")
      expect(result.url).toBe("https://xo.test/download/vdi.vhd")
      expect(result.curlConfig.split("\n")).toEqual([
        `url = "${result.url}"`,
        `header = "Authorization: Basic ${Buffer.from("alice:p:a:ss").toString("base64")}"`,
        `header = "Accept: application/octet-stream"`,
        ...(hasInsecureLine ? ["insecure"] : []),
      ])
    })
  })

  describe("XapiSource.diskDownload", () => {
    it("uses the VDI reference and does not add an Authorization header", async () => {
      const source = await XapiSource.open({ ...xapiCredentials, insecureTLS: true })

      const result = await source.diskDownload(disk, "raw")

      expect(xapiVdiExportUrlMock).toHaveBeenCalledWith(session, "OpaqueRef:vdi", "raw")
      expect(result).toEqual({
        url: "https://xcp.test/export/vdi",
        curlConfig: [
          `url = "https://xcp.test/export/vdi"`,
          `header = "Accept: application/octet-stream"`,
          "insecure",
        ].join("\n"),
      })
      expect(result.curlConfig).not.toContain("Authorization")
    })

    it("throws when the disk has no XAPI VDI reference", async () => {
      const source = await XapiSource.open(xapiCredentials)

      await expect(source.diskDownload({ ...disk, vdiRef: undefined }, "vhd")).rejects.toThrow(
        "disk disk-0 has no XAPI reference",
      )
      expect(xapiVdiExportUrlMock).not.toHaveBeenCalled()
    })
  })

  describe("testXcpngConnection", () => {
    it("returns the host count and closes the source on success", async () => {
      xapiHostsMock.mockResolvedValue([
        { uuid: "host-uuid-1", name_label: "host-1", address: "10.0.0.1", version: "8.3" },
        { uuid: "host-uuid-2", name_label: "host-2", address: "10.0.0.2", version: "8.3" },
      ])

      await expect(testXcpngConnection(xapiCredentials)).resolves.toEqual({ ok: true, hosts: 2 })
      expect(xapiLogoutMock).toHaveBeenCalledWith(session)
    })

    it("maps XAPI authentication failures and closes the source", async () => {
      xapiHostsMock.mockRejectedValue(new Error("XAPI SESSION_AUTHENTICATION_FAILED for root"))

      await expect(testXcpngConnection(xapiCredentials)).resolves.toEqual({
        ok: false,
        error: "Invalid credentials",
      })
      expect(xapiLogoutMock).toHaveBeenCalledWith(session)
    })

    it("returns other errors unchanged and closes the source", async () => {
      xapiHostsMock.mockRejectedValue(new Error("pool master unavailable"))

      await expect(testXcpngConnection(xapiCredentials)).resolves.toEqual({
        ok: false,
        error: "pool master unavailable",
      })
      expect(xapiLogoutMock).toHaveBeenCalledWith(session)
    })
  })
})

// Keep all client imports type-checked against their real module signatures.
void [xoFetch, xoGetVmConfig, xoListHosts, xoListVms, xapiGetVmConfig, xapiGetVmRecord, xapiKeepAlive, xapiListVms]
