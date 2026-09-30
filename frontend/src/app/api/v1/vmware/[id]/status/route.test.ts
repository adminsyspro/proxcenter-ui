/**
 * Tests for GET /api/v1/vmware/[id]/status. The SOAP transport is mocked; the
 * focus is the response shape and the fire-and-forget logout in `finally`,
 * which must run on every successful probe without delaying or failing it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  prisma: { connection: { findUnique: vi.fn() } },
  soapLogin: vi.fn(),
  soapLogout: vi.fn(),
  soapRequest: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { CONNECTION_VIEW: "connection.view" } }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "admin@vsphere.local:pass") }))
vi.mock("@/lib/vmware/soap", () => ({
  soapLogin: h.soapLogin,
  soapLogout: h.soapLogout,
  soapRequest: h.soapRequest,
}))

import { GET } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const session = {
  baseUrl: "https://vcsa.lab/sdk", cookie: "c", insecureTLS: true,
  propertyCollector: "propertyCollector", isVcenter: true,
}

beforeEach(() => {
  h.prisma.connection.findUnique.mockReset().mockResolvedValue({
    id: "conn-1", baseUrl: "https://vcsa.lab/", apiTokenEnc: "enc",
    insecureTLS: true, type: "vmware", subType: "vcenter", vmwareDatacenter: null,
  })
  h.soapLogin.mockReset().mockResolvedValue({ ...session })
  h.soapLogout.mockReset().mockResolvedValue(undefined)
  h.soapRequest.mockReset().mockImplementation(async (_url: string, body: string) => {
    if (body.includes("RetrieveProperties>")) {
      return { text: "<editionKey>vc.enterprise</editionKey>" }
    }
    return { text: "<fullName>VMware vCenter Server 8.0.2 build-22385739</fullName>" }
  })
})

describe("GET /api/v1/vmware/[id]/status", () => {
  it("reports an online vCenter with version and license, then logs out", async () => {
    const res = await callRoute(GET, { params: { id: "conn-1" } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toEqual({
      status: "online",
      host: "https://vcsa.lab",
      version: "VMware vCenter Server 8.0.2 build-22385739",
      licenseEdition: "vc.enterprise",
      licenseFull: true,
      isVcenter: true,
      subType: "vcenter",
    })
    expect(h.soapLogin).toHaveBeenCalledWith("https://vcsa.lab", "admin@vsphere.local", "pass", true)
    expect(h.soapLogout).toHaveBeenCalledTimes(1)
    expect(h.soapLogout).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: session.baseUrl }))
  })

  it("does not fail the probe when the logout rejects", async () => {
    h.soapLogout.mockRejectedValue(new Error("logout boom"))
    const res = await callRoute(GET, { params: { id: "conn-1" } })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data.status).toBe("online")
    expect(h.soapLogout).toHaveBeenCalledTimes(1)
  })
})
