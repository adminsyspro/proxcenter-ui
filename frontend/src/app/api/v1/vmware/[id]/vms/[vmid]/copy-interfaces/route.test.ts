import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  prisma: { connection: { findUnique: vi.fn() } },
  ifaces: vi.fn(),
  logout: vi.fn(async () => {}),
  isVcenter: true,
}))

const scope = vi.hoisted(() => ({ infra: { kind: "provider" } as any }))
vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma), getCurrentTenantId: vi.fn(async () => "t1") }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: vi.fn(async () => scope.infra),
}))
vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { CONNECTION_VIEW: "connection.view" } }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "root:pass") }))
vi.mock("@/lib/vmware/soap", () => ({
  soapLogin: vi.fn(async () => ({ baseUrl: "https://vc", cookie: "c", insecureTLS: true, propertyCollector: "pc", isVcenter: h.isVcenter })),
  soapLogout: h.logout,
}))
vi.mock("@/lib/vmware/vmkernel", () => ({ soapGetVmCopyInterfaces: h.ifaces }))

import { GET } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const IFACES = {
  hostMor: "host-9", hostName: "10.42.0.21", virtualNicManagerMor: "virtualNicManager-9", defaultDevice: "vmk2",
  vnics: [
    { device: "vmk0", key: "k0", address: "10.42.0.21", subnetMask: "255.255.255.0", portgroup: "Management Network", mac: "00:50:56:60:00:01", mtu: 1500, services: ["management"] },
    { device: "vmk2", key: "k2", address: "10.42.53.21", subnetMask: "255.255.255.0", portgroup: "r53-backup", mac: "00:50:56:62:00:01", mtu: 1500, services: ["vSphereBackupNFC"] },
  ],
}

import { checkPermission } from "@/lib/rbac"

beforeEach(() => {
  h.prisma.connection.findUnique.mockReset()
  h.ifaces.mockReset()
  h.logout.mockClear()
  vi.mocked(checkPermission).mockClear()
  h.prisma.connection.findUnique.mockResolvedValue({ id: "c1", baseUrl: "https://vc/", apiTokenEnc: "x", insecureTLS: true, type: "vmware" })
  h.ifaces.mockResolvedValue(IFACES)
})

describe("GET /api/v1/vmware/[id]/vms/[vmid]/copy-interfaces", () => {
  it("returns the adapters of the VM's host with tags, default device and source kind", async () => {
    const res = await callRoute(GET, { params: { id: "c1", vmid: "vm-10936" } })
    expect(res.status).toBe(200)
    const body = await readJson<{ data: any }>(res)
    expect(body.data.hostName).toBe("10.42.0.21")
    expect(body.data.source).toBe("vcenter")
    expect(body.data.defaultDevice).toBe("vmk2")
    expect(body.data.vnics).toEqual([
      { device: "vmk0", address: "10.42.0.21", subnetMask: "255.255.255.0", portgroup: "Management Network", mtu: 1500, services: ["management"] },
      { device: "vmk2", address: "10.42.53.21", subnetMask: "255.255.255.0", portgroup: "r53-backup", mtu: 1500, services: ["vSphereBackupNFC"] },
    ])
    // The mac never reaches the client: nothing in the dialog needs it.
    expect(JSON.stringify(body)).not.toContain("00:50:56")
    expect(h.ifaces).toHaveBeenCalledWith(expect.objectContaining({ isVcenter: true }), "vm-10936", "vc")
    expect(h.logout).toHaveBeenCalledTimes(1)
  })

  it("404s for a vDC tenant or an MSP outside its connections, and checks the right on the connection", async () => {
    try {
      for (const infra of [{ kind: "iaas", vdcScope: {} }, { kind: "msp", connectionIds: new Set(["other"]) }]) {
        scope.infra = infra
        const res = await callRoute(GET, { params: { id: "c1", vmid: "vm-14" } })
        expect(res.status).toBe(404)
      }
      expect(h.ifaces).not.toHaveBeenCalled()
      expect(checkPermission).not.toHaveBeenCalled()
    } finally {
      scope.infra = { kind: "provider" }
    }
    await callRoute(GET, { params: { id: "c1", vmid: "vm-14" } })
    expect(checkPermission).toHaveBeenCalledWith("connection.view", "connection", "c1")
  })

  it("rejects a malformed VM reference before touching the source", async () => {
    const res = await callRoute(GET, { params: { id: "c1", vmid: "vm 1<" } })
    expect(res.status).toBe(400)
    expect(h.ifaces).not.toHaveBeenCalled()
  })

  it("404s on a non-VMware connection", async () => {
    h.prisma.connection.findUnique.mockResolvedValue({ id: "c1", type: "proxmox" })
    const res = await callRoute(GET, { params: { id: "c1", vmid: "vm-1" } })
    expect(res.status).toBe(404)
  })

  it("maps a SOAP failure to 500 and still logs out", async () => {
    h.ifaces.mockRejectedValue(new Error("vSphere did not report the host this VM runs on"))
    const res = await callRoute(GET, { params: { id: "c1", vmid: "vm-1" } })
    expect(res.status).toBe(500)
    expect((await readJson<{ error: string }>(res)).error).toMatch(/did not report the host/)
    expect(h.logout).toHaveBeenCalledTimes(1)
  })
})
