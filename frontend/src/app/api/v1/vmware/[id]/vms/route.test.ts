/**
 * Tests for GET /api/v1/vmware/[id]/vms. SOAP is mocked; checks the VM list
 * mapping (host inventory path fields) and the fire-and-forget logout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  prisma: { connection: { findUnique: vi.fn() } },
  soapLogin: vi.fn(),
  soapLogout: vi.fn(),
  soapListVMs: vi.fn(),
  soapResolveHostInventoryPaths: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { CONNECTION_VIEW: "connection.view" } }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "root:pass") }))
vi.mock("@/lib/vmware/soap", () => ({
  soapLogin: h.soapLogin,
  soapLogout: h.soapLogout,
  soapListVMs: h.soapListVMs,
  soapResolveHostInventoryPaths: h.soapResolveHostInventoryPaths,
}))

import { GET } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

beforeEach(() => {
  h.prisma.connection.findUnique.mockReset().mockResolvedValue({
    id: "conn-1", name: "vcsa-lab", baseUrl: "https://vcsa.lab/", apiTokenEnc: "enc",
    insecureTLS: true, type: "vmware", subType: "vcenter", vmwareDatacenter: "DC1",
  })
  h.soapLogin.mockReset().mockResolvedValue({ baseUrl: "https://vcsa.lab/sdk", cookie: "c", insecureTLS: true, isVcenter: true })
  h.soapLogout.mockReset().mockResolvedValue(undefined)
  h.soapListVMs.mockReset().mockResolvedValue([
    { moId: "vm-42", name: "web-01", powerState: "poweredOn", cpu: 2, memoryMB: 4096, guestOS: "Ubuntu", committedStorage: 100, uncommittedStorage: 0, hostMor: "host-10", toolsStatus: "toolsOk", toolsRunningStatus: "guestToolsRunning" },
  ])
  h.soapResolveHostInventoryPaths.mockReset().mockResolvedValue(new Map([
    ["host-10", { datacenter: "DC1", cluster: "Cluster-A", host: "esxi-21.lab", status: "ok", connectionState: "connected", powerState: "poweredOn" }],
  ]))
})

describe("GET /api/v1/vmware/[id]/vms", () => {
  it("maps VMs with their host inventory path and logs out", async () => {
    const res = await callRoute(GET, { params: { id: "conn-1" } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.connectionName).toBe("vcsa-lab")
    expect(body.data.vms).toEqual([
      expect.objectContaining({
        vmid: "vm-42", name: "web-01", status: "running", cpu: 2, memory_size_MiB: 4096,
        vcenterDatacenter: "DC1", vcenterCluster: "Cluster-A", vcenterHost: "esxi-21.lab",
        vcenterHostStatus: "ok", vcenterHostConnectionState: "connected", vcenterHostPowerState: "poweredOn",
      }),
    ])
    expect(h.soapLogin).toHaveBeenCalledWith("https://vcsa.lab", "root", "pass", true)
    expect(h.soapLogout).toHaveBeenCalledTimes(1)
    expect(h.soapLogout.mock.calls[0][0].datacenterPath).toBe("DC1")
  })

  it("still returns the list when the logout rejects", async () => {
    h.soapLogout.mockRejectedValue(new Error("logout boom"))
    const res = await callRoute(GET, { params: { id: "conn-1" } })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data.vms).toHaveLength(1)
  })
})
