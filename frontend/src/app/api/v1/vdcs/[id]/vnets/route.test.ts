/**
 * Wiring tests for POST /api/v1/vdcs/{id}/vnets: the request-parsing guards
 * and the lib-error -> HTTP-status mapping table. The orchestration itself is
 * covered by src/lib/vdc/vnets.test.ts, so createVnetForTenant is mocked here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null as any),
  getCurrentTenantId: vi.fn(async () => "tenant-a"),
  createVnetForTenant: vi.fn(async () => ({ id: "vnet-1" }) as any),
  listVnetsForTenant: vi.fn(async () => [] as any[]),
  getSubnetUsage: vi.fn(async () => ({ used: 0, usable: 0 })),
}))

// The API token guard is covered by routeGuard.test.ts and vnetTokenScope.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock("@/lib/api-tokens/routeGuard", () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))
vi.mock("@/lib/rbac", () => ({
  checkPermission: h.checkPermission,
  PERMISSIONS: { SDN_VNET_VIEW: "sdn.vnet.view", SDN_VNET_CREATE: "sdn.vnet.create", SDN_VNET_EDIT: "sdn.vnet.edit", SDN_VNET_DELETE: "sdn.vnet.delete" },
}))
vi.mock("@/lib/auth/principal", () => ({
  getPrincipal: vi.fn(async () => ({ ok: true, principal: { kind: "session", userId: "u1", tenantId: "tenant-a", connectionIds: null } })),
}))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: h.getCurrentTenantId }))
vi.mock("@/lib/vdc/vnets", () => ({
  createVnetForTenant: h.createVnetForTenant,
  listVnetsForTenant: h.listVnetsForTenant,
}))
vi.mock("@/lib/vdc/ipam", () => ({ getSubnetUsage: h.getSubnetUsage }))
// The tenant check of vnetPermission.ts: the vDC belongs to the caller's tenant.
vi.mock("@/lib/db/prisma", () => ({
  prisma: { vdc: { findUnique: async () => ({ tenantId: "tenant-a", connectionId: "c1" }) } },
}))

import { POST } from "./route"
import { VniError } from "@/lib/vdc/vniPolicy"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const BODY = {
  displayName: "lan",
  subnet: { cidr: "10.42.0.0/24", gateway: "10.42.0.1" },
}

function post(body: Record<string, unknown>) {
  return callRoute(POST, { params: { id: "vdc-1" }, body })
}

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.getCurrentTenantId.mockReset().mockResolvedValue("tenant-a")
  h.createVnetForTenant.mockReset().mockResolvedValue({ id: "vnet-1" })
})

describe("POST /api/v1/vdcs/[id]/vnets", () => {
  it("forwards the VLAN fields to the lib and returns 201", async () => {
    const res = await post({ ...BODY, type: "vlan", bridge: " vmbr0 ", vlanTag: "150", externalAddressing: true })
    expect(res.status).toBe(201)
    expect(h.createVnetForTenant).toHaveBeenCalledWith(expect.objectContaining({
      type: "vlan", bridge: "vmbr0", vlanTag: 150, externalAddressing: true,
    }))
  })

  it("400 on an out-of-range vlanTag, without reaching the lib", async () => {
    const res = await post({ ...BODY, type: "vlan", bridge: "vmbr0", vlanTag: 5000 })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toMatch(/between 1 and 4094/)
    expect(h.createVnetForTenant).not.toHaveBeenCalled()
  })

  it("400 when the vDC has no SDN zone (VXLAN unavailable), not 500", async () => {
    h.createVnetForTenant.mockRejectedValue(
      new Error("vDC has no SDN zone - VXLAN networks are unavailable on this vDC"),
    )
    const res = await post(BODY)
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toMatch(/VXLAN networks are unavailable/)
  })

  it("409 on PVE's cross-zone tag backstop (\"already exist\", no trailing s)", async () => {
    h.createVnetForTenant.mockRejectedValue(
      new Error('Failed to create SDN VNet "lan": tag 137 already exist in vnet v1234abc'),
    )
    const res = await post({ ...BODY, type: "vlan", bridge: "vmbr0" })
    expect(res.status).toBe(409)
    expect((await readJson<any>(res))?.error).toMatch(/already exist/)
  })

  describe("pure L2 network and tenant VNI (roadmap#18)", () => {
    it("forwards a null subnet when none is given, or when it is left empty", async () => {
      expect((await post({ displayName: "l2" })).status).toBe(201)
      expect(h.createVnetForTenant).toHaveBeenLastCalledWith(expect.objectContaining({ subnet: null, vni: null }))
      expect((await post({ displayName: "l2", subnet: { cidr: " ", gateway: "" } })).status).toBe(201)
      expect(h.createVnetForTenant).toHaveBeenLastCalledWith(expect.objectContaining({ subnet: null }))
    })

    it("400 on a subnet that is not an object, or with a CIDR and no gateway", async () => {
      const notObject = await post({ displayName: "l2", subnet: "10.0.0.0/24" })
      expect(notObject.status).toBe(400)
      expect((await readJson<any>(notObject))?.error).toMatch(/or null for a pure L2 network/)
      const noGateway = await post({ displayName: "l2", subnet: { cidr: "10.0.0.0/24" } })
      expect(noGateway.status).toBe(400)
      expect((await readJson<any>(noGateway))?.error).toMatch(/required when a subnet is given/)
      expect(h.createVnetForTenant).not.toHaveBeenCalled()
    })

    it("parses DNS servers from an array or a comma-separated string", async () => {
      await post({ ...BODY, subnet: { ...BODY.subnet, dnsServers: [" 1.1.1.1 ", ""] } })
      expect(h.createVnetForTenant).toHaveBeenLastCalledWith(expect.objectContaining({
        subnet: { cidr: "10.42.0.0/24", gateway: "10.42.0.1", dnsServers: ["1.1.1.1"] },
      }))
      await post({ ...BODY, subnet: { ...BODY.subnet, dnsServers: "1.1.1.1, 9.9.9.9" } })
      expect(h.createVnetForTenant).toHaveBeenLastCalledWith(expect.objectContaining({
        subnet: { cidr: "10.42.0.0/24", gateway: "10.42.0.1", dnsServers: ["1.1.1.1", "9.9.9.9"] },
      }))
      await post({ ...BODY, subnet: { ...BODY.subnet, dnsServers: 42 } })
      expect(h.createVnetForTenant).toHaveBeenLastCalledWith(expect.objectContaining({
        subnet: { cidr: "10.42.0.0/24", gateway: "10.42.0.1", dnsServers: undefined },
      }))
    })

    it("forwards the chosen VNI and maps a VniError to its own status", async () => {
      h.createVnetForTenant.mockRejectedValueOnce(new VniError("VNI 20005 is already in use", 409))
      const taken = await post({ displayName: "l2", vni: 20005 })
      expect(h.createVnetForTenant).toHaveBeenLastCalledWith(expect.objectContaining({ vni: 20005 }))
      expect(taken.status).toBe(409)
      h.createVnetForTenant.mockRejectedValueOnce(new VniError("VNI 30000 is outside the range", 400))
      expect((await post({ displayName: "l2", vni: 30000 })).status).toBe(400)
    })

    it("400 when a platform edge needs the subnet, or on a VNI for a VLAN network", async () => {
      h.createVnetForTenant.mockRejectedValueOnce(new Error("Your provider operates the L3 edge: define the subnet"))
      expect((await post({ displayName: "l2" })).status).toBe(400)
      h.createVnetForTenant.mockRejectedValueOnce(new Error("vni applies to VXLAN networks only"))
      expect((await post({ displayName: "l2", type: "vlan", bridge: "vmbr0", vni: 5 })).status).toBe(400)
    })
  })
})
