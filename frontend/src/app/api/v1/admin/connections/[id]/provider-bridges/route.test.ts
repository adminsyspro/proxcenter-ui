/**
 * GET /api/v1/admin/connections/[id]/provider-bridges - physical bridges AND
 * SDN VNets available for a vDC's shared uplink picker.
 *
 * Default mode (no scope) excludes SDN zone uplinks from the host-bridge list
 * and returns VNets separately with `type: 'sdn-vnet'`.
 * `scope=vlan-pool` excludes ONLY vnet names (zone uplinks are legitimate
 * VLAN-pool bridges) and adds a `vlanAware` flag derived from
 * `bridge_vlan_aware`, OR-ed across nodes when a bridge appears on more than
 * one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { callRoute } from "@/__tests__/setup/route-test"

const { requireProviderTenantMock, checkPermissionMock, connFindUniqueMock, vdcFindManyMock, vdcVnetFindManyMock, getConnectionByIdMock, pveFetchMock } =
  vi.hoisted(() => ({
    requireProviderTenantMock: vi.fn(),
    checkPermissionMock: vi.fn(),
    connFindUniqueMock: vi.fn(),
    vdcFindManyMock: vi.fn(),
    vdcVnetFindManyMock: vi.fn(),
    getConnectionByIdMock: vi.fn(),
    pveFetchMock: vi.fn(),
  }))

vi.mock("@/lib/tenant", () => ({
  requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: "admin.settings" },
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findUnique: (...a: unknown[]) => connFindUniqueMock(...a) },
    vdc: { findMany: (...a: unknown[]) => vdcFindManyMock(...a) },
    vdcVnet: { findMany: (...a: unknown[]) => vdcVnetFindManyMock(...a) },
  },
}))

vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: unknown[]) => getConnectionByIdMock(...a),
}))

vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...a: unknown[]) => pveFetchMock(...a),
}))

import { GET } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  connFindUniqueMock.mockResolvedValue({ tenantId: "t1" })
  vdcFindManyMock.mockResolvedValue([])
  vdcVnetFindManyMock.mockResolvedValue([])
  getConnectionByIdMock.mockResolvedValue({ id: "c1", baseUrl: "https://h", apiToken: "tok" })
})

/** Single node: vmbr0 is a zone uplink (vlan_aware), vmbr1 is a plain physical bridge, vfoo is a vnet in zone z1. */
function mockSingleNode() {
  pveFetchMock.mockImplementation(async (_conn: unknown, path: string) => {
    if (path === "/cluster/sdn/zones") return [{ bridge: "vmbr0" }]
    if (path === "/cluster/sdn/vnets") return [{ vnet: "vfoo", zone: "z1", tag: 100, alias: "Frontend" }]
    if (path === "/nodes") return [{ node: "pve1" }]
    if (path === "/nodes/pve1/network") {
      return [
        { iface: "vmbr0", type: "bridge", active: 1, bridge_vlan_aware: 1 },
        { iface: "vmbr1", type: "bridge", active: 1 },
        { iface: "vfoo", type: "bridge", active: 1 },
      ]
    }
    throw new Error(`unexpected path ${path}`)
  })
}

describe("GET /api/v1/admin/connections/[id]/provider-bridges - default mode", () => {
  it("excludes zone uplinks from host bridges and returns vnets as sdn-vnet entries", async () => {
    mockSingleNode()
    const res = await callRoute(GET, { params: { id: "c1" } })
    expect(res.status).toBe(200)

    const body = await res.json()
    const bridges = body.data.filter((b: any) => b.type !== "sdn-vnet")
    const vnets = body.data.filter((b: any) => b.type === "sdn-vnet")

    expect(bridges).toEqual([{ iface: "vmbr1", nodes: ["pve1"], type: "bridge", active: 1 }])
    expect(vnets).toEqual([{ iface: "vfoo", type: "sdn-vnet", zone: "z1", tag: 100, alias: "Frontend" }])
  })

  it("excludes VNets whose zone is already assigned to a vDC (tenant-managed)", async () => {
    vdcFindManyMock.mockResolvedValue([{ sdnZoneName: "z1" }])
    mockSingleNode()
    const res = await callRoute(GET, { params: { id: "c1" } })
    expect(res.status).toBe(200)

    const body = await res.json()
    const vnets = body.data.filter((b: any) => b.type === "sdn-vnet")
    expect(vnets).toEqual([])
  })
})

describe("GET /api/v1/admin/connections/[id]/provider-bridges - scope=vlan-pool", () => {
  it("excludes only vnet names (zone uplinks stay), and flags vlanAware from bridge_vlan_aware", async () => {
    mockSingleNode()
    const res = await callRoute(GET, { params: { id: "c1" }, searchParams: { scope: "vlan-pool" } })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data).toEqual([
      { iface: "vmbr0", nodes: ["pve1"], type: "bridge", active: 1, vlanAware: true },
      { iface: "vmbr1", nodes: ["pve1"], type: "bridge", active: 1, vlanAware: false },
    ])
    expect(body.data.some((b: { iface: string }) => b.iface === "vfoo")).toBe(false)
  })

  it("ORs vlanAware across nodes when a bridge appears on more than one", async () => {
    pveFetchMock.mockImplementation(async (_conn: unknown, path: string) => {
      if (path === "/cluster/sdn/zones") return []
      if (path === "/cluster/sdn/vnets") return []
      if (path === "/nodes") return [{ node: "pve1" }, { node: "pve2" }]
      if (path === "/nodes/pve1/network") return [{ iface: "vmbr1", type: "bridge", active: 1 }]
      if (path === "/nodes/pve2/network") {
        return [{ iface: "vmbr1", type: "bridge", active: 1, bridge_vlan_aware: 1 }]
      }
      throw new Error(`unexpected path ${path}`)
    })

    const res = await callRoute(GET, { params: { id: "c1" }, searchParams: { scope: "vlan-pool" } })
    const body = await res.json()
    expect(body.data).toEqual([
      { iface: "vmbr1", nodes: ["pve1", "pve2"], type: "bridge", active: 1, vlanAware: true },
    ])
  })
})
