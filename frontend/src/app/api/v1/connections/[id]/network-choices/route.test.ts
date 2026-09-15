import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const {
  checkPermissionMock,
  guestPerimeterAllowsMock,
  getConnectionByIdMock,
  pveFetchMock,
  getCurrentTenantIdMock,
  getTenantInfrastructureScopeMock,
  maskingScopeMock,
  connectionFindUniqueMock,
  vdcVnetFindManyMock,
  vdcSharedBridgeFindManyMock,
  vdcVlanPoolFindManyMock,
} = vi.hoisted(() => ({
  vdcVlanPoolFindManyMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  guestPerimeterAllowsMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  getTenantInfrastructureScopeMock: vi.fn(),
  maskingScopeMock: vi.fn(),
  connectionFindUniqueMock: vi.fn(),
  vdcVnetFindManyMock: vi.fn(),
  vdcSharedBridgeFindManyMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  guestPerimeterAllows: (...a: any[]) => guestPerimeterAllowsMock(...a),
  buildNodeResourceId: (id: string, node: string) => `${id}/${node}`,
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => getConnectionByIdMock(...a),
}))
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...a: any[]) => pveFetchMock(...a),
}))
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: (...a: any[]) => getCurrentTenantIdMock(...a),
}))
vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: (...a: any[]) => getTenantInfrastructureScopeMock(...a),
  maskingScope: (...a: any[]) => maskingScopeMock(...a),
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findUnique: (...a: any[]) => connectionFindUniqueMock(...a) },
    vdcVnet: { findMany: (...a: any[]) => vdcVnetFindManyMock(...a) },
    vdcSharedBridge: { findMany: (...a: any[]) => vdcSharedBridgeFindManyMock(...a) },
    vdcVlanPool: { findMany: (...a: any[]) => vdcVlanPoolFindManyMock(...a) },
  },
}))

const PARAMS = { id: "conn-1" }
const QUERY = { node: "pve1" }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  // Flat-scoped fallback off by default: the denial path stays the denial path.
  guestPerimeterAllowsMock.mockReset().mockResolvedValue(false)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: "c", baseUrl: "https://x:8006", apiToken: "t" })
  pveFetchMock.mockReset().mockImplementation((_conn: any, path: string) => {
    if (path.endsWith("/network")) {
      return Promise.resolve([{ iface: "vmbr0", type: "bridge" }])
    }
    if (path === "/cluster/sdn/vnets") return Promise.resolve([])
    return Promise.resolve([])
  })
  getCurrentTenantIdMock.mockReset().mockResolvedValue("provider-tenant")
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: "provider" })
  // provider: no vDC masking, so the route takes the full-cluster branch.
  maskingScopeMock.mockReset().mockReturnValue(null)
  connectionFindUniqueMock.mockReset().mockResolvedValue({ tenantId: "provider-tenant" })
  vdcVnetFindManyMock.mockReset().mockResolvedValue([])
  vdcSharedBridgeFindManyMock.mockReset().mockResolvedValue([])
})

describe("GET /api/v1/connections/[id]/network-choices", () => {
  it("returns the cluster bridges when the caller holds connection.view", async () => {
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS, searchParams: QUERY })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual([{ kind: "bridge", name: "vmbr0", type: "bridge" }])
    // Permission granted, so the guest-derived fallback is never consulted.
    expect(guestPerimeterAllowsMock).not.toHaveBeenCalled()
  })

  it("returns the RBAC denial without calling PVE when no guest opens the perimeter", async () => {
    checkPermissionMock.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS, searchParams: QUERY })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  // Issue #262: a pool-scoped user matches no node resource, so the Network tab
  // of the creation wizard needs the guest-derived fallback to answer.
  it("serves a flat-scoped caller whose guests live on this cluster", async () => {
    checkPermissionMock.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }))
    guestPerimeterAllowsMock.mockResolvedValue(true)

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS, searchParams: QUERY })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual([{ kind: "bridge", name: "vmbr0", type: "bridge" }])
    expect(guestPerimeterAllowsMock).toHaveBeenCalledWith("conn-1", "connection.view")
  })
})

describe("GET /api/v1/connections/[id]/network-choices: iaas tenant slice", () => {
  beforeEach(() => {
    getCurrentTenantIdMock.mockResolvedValue("t1")
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: "iaas" })
    maskingScopeMock.mockReturnValue({
      vnetsByConnection: new Map([["conn-1", new Set(["v32cf5fc", "vlan100"])]]),
      sharedBridgesByConnection: new Map([["conn-1", new Set(["vmbr1"])]]),
    })
    vdcVlanPoolFindManyMock.mockReset().mockResolvedValue([])
  })

  it("serves the vDC VNets, with the shared pool of a stretched network, and the shared bridges with their VLAN ranges", async () => {
    // First read: the subnets per VNet; second: the VNet rows of the tenant.
    vdcVnetFindManyMock.mockImplementation(async ({ select }: any) => select?.subnet
      ? [
          {
            pveName: "v32cf5fc",
            subnet: { id: "mirror-s1", cidr: "198.51.100.0/24", gateway: "198.51.100.1", dnsServers: "198.51.100.2, 198.51.100.3" },
            // Member of a stretched network (#901): the pool is the canonical subnet.
            tenantNetworkMember: { tenantNetwork: { subnet: { id: "canonical-s1" } } },
          },
          { pveName: "vlan100", subnet: { id: "s2", cidr: "192.0.2.0/24", gateway: "192.0.2.1", dnsServers: null }, tenantNetworkMember: null },
          { pveName: "orphan", subnet: null, tenantNetworkMember: null },
        ]
      : [
          { pveName: "v32cf5fc", displayName: "backbone", zoneName: "zacme", type: "vxlan", vdc: { id: "vdc-1", slug: "acme-paris", sdnZoneName: "zacme" } },
          { pveName: "vlan100", displayName: null, zoneName: "vlanvmbr0", type: "vlan", vdc: { id: "vdc-1", slug: "acme-paris", sdnZoneName: "zacme" } },
          // Not in the tenant's allow-list: never offered.
          { pveName: "hidden", displayName: "hidden", zoneName: null, type: "vxlan", vdc: { id: "vdc-1", slug: "acme-paris", sdnZoneName: "zacme" } },
        ])
    vdcSharedBridgeFindManyMock.mockResolvedValue([{ bridge: "vmbr1", label: "DMZ", vdcId: "vdc-1" }])
    vdcVlanPoolFindManyMock.mockResolvedValue([
      { bridge: "vmbr1", rangeStart: 100, rangeEnd: 199 },
      { bridge: "vmbr1", rangeStart: 300, rangeEnd: 310 },
    ])

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS, searchParams: QUERY })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual([
      {
        kind: "vnet", name: "v32cf5fc", displayName: "backbone", vdc: "acme-paris", vdcId: "vdc-1", zone: "zacme",
        subnet: { subnetId: "canonical-s1", cidr: "198.51.100.0/24", gateway: "198.51.100.1", dnsServers: ["198.51.100.2", "198.51.100.3"] },
      },
      {
        kind: "vnet", name: "vlan100", displayName: "vlan100", vdc: "acme-paris", vdcId: "vdc-1", zone: "vlanvmbr0",
        subnet: { subnetId: "s2", cidr: "192.0.2.0/24", gateway: "192.0.2.1", dnsServers: [] },
      },
      { kind: "shared", name: "vmbr1", label: "DMZ", vlanRanges: [[100, 199], [300, 310]] },
    ])
    expect(vdcVlanPoolFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { vdcId: { in: ["vdc-1"] }, bridge: { in: ["vmbr1"] } },
    }))
    // The tenant slice never asks PVE for the cluster bridges.
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("offers a shared bridge without label or pool as-is, and skips the pool query when no vDC declares the bridge", async () => {
    vdcVnetFindManyMock.mockResolvedValue([])
    vdcSharedBridgeFindManyMock.mockResolvedValue([])

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS, searchParams: QUERY })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toEqual([{ kind: "shared", name: "vmbr1", label: null, vlanRanges: [] }])
    expect(vdcVlanPoolFindManyMock).not.toHaveBeenCalled()
  })

  it("404s an MSP tenant on a connection it does not own", async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-9"]) })
    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { params: PARAMS, searchParams: QUERY })
    expect(res.status).toBe(404)
    expect(connectionFindUniqueMock).not.toHaveBeenCalled()
  })
})
