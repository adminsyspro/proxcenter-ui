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

vi.mock("@/lib/rbac", () => ({ checkPermission: h.checkPermission, PERMISSIONS: {} }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: h.getCurrentTenantId }))
vi.mock("@/lib/vdc/vnets", () => ({
  createVnetForTenant: h.createVnetForTenant,
  listVnetsForTenant: h.listVnetsForTenant,
}))
vi.mock("@/lib/vdc/ipam", () => ({ getSubnetUsage: h.getSubnetUsage }))

import { POST } from "./route"
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
})
