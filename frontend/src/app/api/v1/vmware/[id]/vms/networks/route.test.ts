/** ui#1333: POST /api/v1/vmware/[id]/vms/networks, the source networks of a bulk selection. */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  prisma: { connection: { findUnique: vi.fn() } },
  denied: null as Response | null,
  soapLogin: vi.fn(),
  soapLogout: vi.fn(),
  soapGetVmsNics: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => h.denied), PERMISSIONS: { CONNECTION_VIEW: "connection.view" } }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "admin@vsphere.local:pass") }))
vi.mock("@/lib/vmware/soap", () => ({ soapLogin: h.soapLogin, soapLogout: h.soapLogout, soapGetVmsNics: h.soapGetVmsNics }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const post = (body: Record<string, unknown>) => callRoute(POST, { params: { id: "vc" }, body })

beforeEach(() => {
  h.denied = null
  h.prisma.connection.findUnique.mockReset().mockResolvedValue({ id: "vc", baseUrl: "https://vcsa/", apiTokenEnc: "enc", insecureTLS: true, type: "vmware" })
  h.soapLogin.mockReset().mockResolvedValue({ cookie: "c" })
  h.soapLogout.mockReset().mockResolvedValue(undefined)
  h.soapGetVmsNics.mockReset().mockResolvedValue(new Map([
    ["vm-1", [{ network: "VM Network" }, { network: "DMZ" }, { network: "DMZ" }]],
    ["vm-2", [{ network: "VM Network" }, { network: "" }]],
  ]))
})

describe("POST /api/v1/vmware/[id]/vms/networks", () => {
  it("answers each network of the selection once, with the VMs on it, in name order", async () => {
    const res = await post({ vmids: ["vm-1", "vm-2"] })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data).toEqual({ networks: [{ name: "DMZ", vmCount: 1 }, { name: "VM Network", vmCount: 2 }], vmsRead: 2 })
    expect(h.soapLogin).toHaveBeenCalledWith("https://vcsa", "admin@vsphere.local", "pass", true)
    expect(h.soapGetVmsNics).toHaveBeenCalledWith({ cookie: "c" }, ["vm-1", "vm-2"])
    expect(h.soapLogout).toHaveBeenCalled()
  })

  it.each([
    [{}],
    [{ vmids: [] }],
    [{ vmids: ["vm 1"] }],
    [{ vmids: Array.from({ length: 501 }, (_, i) => `vm-${i}`) }],
  ])("refuses %j", async body => {
    expect((await post(body)).status).toBe(400)
    expect(h.soapLogin).not.toHaveBeenCalled()
  })

  it("answers 404 for a connection that is not VMware", async () => {
    h.prisma.connection.findUnique.mockResolvedValue({ id: "vc", type: "pve" })
    expect((await post({ vmids: ["vm-1"] })).status).toBe(404)
  })

  it("needs connection.view", async () => {
    h.denied = new Response(null, { status: 403 })
    expect((await post({ vmids: ["vm-1"] })).status).toBe(403)
  })
})
