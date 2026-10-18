import { beforeEach, describe, expect, it, vi } from "vitest"

// Hoist mocks so they are available in vi.mock factories
const { pveFetchMock, upsertMock, deleteManyMock, findManyMock, connFindUniqueMock, resolveMock, setNodeIpsMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  upsertMock: vi.fn().mockResolvedValue({}),
  deleteManyMock: vi.fn().mockResolvedValue({ count: 0 }),
  findManyMock: vi.fn().mockResolvedValue([]),
  connFindUniqueMock: vi.fn(),
  resolveMock: vi.fn(),
  setNodeIpsMock: vi.fn(),
}))

vi.mock("./client", () => ({ pveFetch: pveFetchMock }))
// Faithful to the real helper: no interfaces means no management IP. A mock
// that answers regardless of its input cannot express a node that stopped
// answering, which is the case under test below.
vi.mock("./resolveManagementIp", () => ({ resolveManagementAddress: resolveMock }))
vi.mock("../cache/nodeIpCache", () => ({ setNodeIps: setNodeIpsMock }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findUnique: connFindUniqueMock },
    managedHost: { upsert: upsertMock, deleteMany: deleteManyMock, findMany: findManyMock },
  },
}))

import { discoverNodeIps } from "./discoverNodeIps"

const CONN_OPTS = { baseUrl: "https://10.0.0.1:8006", apiToken: "t", insecureDev: false }

/** Upsert arguments by node name. */
const upserts = () => new Map(upsertMock.mock.calls.map(c => [c[0].where.connectionId_node.node, c[0]]))

beforeEach(() => {
  vi.clearAllMocks()
  upsertMock.mockResolvedValue({})
  deleteManyMock.mockResolvedValue({ count: 0 })
  findManyMock.mockResolvedValue([])
  connFindUniqueMock.mockResolvedValue({ tenantId: "msp-1" })
  resolveMock.mockImplementation((networks: any) =>
    Array.isArray(networks) && networks.length > 0 ? { ip: "10.0.0.5", verified: true } : undefined,
  )
  // Routed by path rather than by call order: discovery also asks
  // /cluster/status, and a sequential mock would break on any new call.
  pveFetchMock.mockImplementation(async (_opts: any, path: string) => {
    if (path === "/nodes") return [{ node: "pve1" }]
    if (path === "/cluster/status") return [{ type: "node", name: "pve1", ip: "10.0.0.5" }]
    if (path.endsWith("/network")) return [{ iface: "vmbr0", type: "bridge" }]

    return null
  })
})

describe("discoverNodeIps", () => {
  it("persists ManagedHost rows under the connection owner's tenant", async () => {
    const ips = await discoverNodeIps(CONN_OPTS as any, "c-msp")

    expect(ips).toEqual(["10.0.0.5"])
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ connectionId: "c-msp", tenantId: "msp-1", ip: "10.0.0.5", ipVerified: true }),
      })
    )
    expect(setNodeIpsMock).toHaveBeenCalledWith("c-msp", ["10.0.0.5"], 8006, "https")
  })

  // A node that just died answers nothing on /nodes/<node>/network, so the
  // discovery used to write ip: null over a known-good address. That removed
  // the node from the failover candidate list at the exact moment the cluster
  // was degraded and the list mattered.
  it("keeps the stored IP when a node no longer answers", async () => {
    // Two nodes on purpose: persistence is skipped entirely when no node has
    // an IP, so the overwrite only ever happened on a partially reachable
    // cluster, which is exactly the degraded state that matters.
    pveFetchMock.mockImplementation(async (_opts: any, path: string) => {
      if (path === "/nodes") return [{ node: "pve1" }, { node: "pve2" }]
      if (path === "/cluster/status") return null
      if (path === "/nodes/pve1/network") throw new Error("host unreachable")
      if (path.endsWith("/network")) return [{ iface: "vmbr0", type: "bridge" }]

      return null
    })

    await discoverNodeIps(CONN_OPTS as any, "c-1")

    // The dead node keeps whatever address is on file.
    expect(upserts().get("pve1")!.update).toEqual({})

    // The live one is still refreshed.
    expect(upserts().get("pve2")!.update).toEqual({ ip: "10.0.0.5", ipVerified: true })
  })

  // /cluster/status reports a member's IP even when that member is offline, so
  // it recovers the address the per-node lookup could not reach. It is the
  // corosync link though, hence a guess, stored only because nothing better
  // is known and tried after the management addresses.
  it("falls back to cluster status for an offline node, as a guess tried last", async () => {
    pveFetchMock.mockImplementation(async (_opts: any, path: string) => {
      if (path === "/nodes") return [{ node: "pve1" }, { node: "pve2" }]
      if (path === "/cluster/status") {
        return [
          { type: "cluster", name: "lab" },
          { type: "node", name: "pve1", ip: "10.0.0.1", online: 0 },
          { type: "node", name: "pve2", ip: "10.0.0.2", online: 1 },
        ]
      }
      if (path === "/nodes/pve1/network") throw new Error("host unreachable")
      if (path.endsWith("/network")) return [{ iface: "vmbr0", type: "bridge" }]

      return null
    })

    const ips = await discoverNodeIps(CONN_OPTS as any, "c-1")

    // pve1 comes from cluster status, pve2 from its own network lookup.
    expect(ips).toEqual(["10.0.0.5", "10.0.0.1"])
    expect(upserts().get("pve1")!.update).toEqual({ ip: "10.0.0.1", ipVerified: false })
  })

  // roadmap#51: a token without SDN.Audit on /sdn/zones/localnetwork gets an
  // interface list without the bridges, so the only addressed interface left
  // (a storage or VXLAN-transport VLAN) looked like the management address
  // and replaced it in every row, taking every candidate off the routed network.
  it("never replaces a verified management address with a guess from a filtered interface list", async () => {
    findManyMock.mockResolvedValue([
      { node: "pve1", ip: "10.42.0.101", ipVerified: true },
      { node: "pve2", ip: "10.42.0.102", ipVerified: true },
    ])
    resolveMock.mockReturnValue({ ip: "10.100.5.1", verified: false })
    pveFetchMock.mockImplementation(async (_opts: any, path: string) => {
      if (path === "/nodes") return [{ node: "pve1" }, { node: "pve2" }]
      if (path === "/cluster/status") throw new Error("Permission check failed (/, Sys.Audit)")
      if (path.endsWith("/network")) return [{ iface: "vmbr0.4000", type: "vlan", address: "10.100.5.1" }]

      return null
    })

    const ips = await discoverNodeIps(CONN_OPTS as any, "c-1")

    expect(upserts().get("pve1")!.update).toEqual({})
    expect(upserts().get("pve2")!.update).toEqual({})
    expect(ips).toEqual(["10.42.0.101", "10.42.0.102"])
    expect(setNodeIpsMock).toHaveBeenCalledWith("c-1", ["10.42.0.101", "10.42.0.102"], 8006, "https")
  })

  it("stores a guess when nothing is known, flagged and after the verified addresses", async () => {
    resolveMock.mockImplementation((networks: any) =>
      networks?.[0]?.iface === "vmbr0" ? { ip: "10.42.0.102", verified: true } : { ip: "10.100.5.1", verified: false },
    )
    pveFetchMock.mockImplementation(async (_opts: any, path: string) => {
      if (path === "/nodes") return [{ node: "pve1" }, { node: "pve2" }]
      if (path === "/cluster/status") return null
      if (path === "/nodes/pve1/network") return [{ iface: "vmbr0.4000", type: "vlan" }]
      if (path === "/nodes/pve2/network") return [{ iface: "vmbr0", type: "bridge" }]

      return null
    })

    const ips = await discoverNodeIps(CONN_OPTS as any, "c-1")

    expect(upserts().get("pve1")!.create).toEqual(expect.objectContaining({ ip: "10.100.5.1", ipVerified: false }))
    expect(upserts().get("pve2")!.create).toEqual(expect.objectContaining({ ip: "10.42.0.102", ipVerified: true }))
    expect(ips).toEqual(["10.42.0.102", "10.100.5.1"])
  })

  it("keeps a verified address over the corosync link of a node that stopped answering", async () => {
    findManyMock.mockResolvedValue([{ node: "pve1", ip: "10.42.0.101", ipVerified: true }])
    pveFetchMock.mockImplementation(async (_opts: any, path: string) => {
      if (path === "/nodes") return [{ node: "pve1" }, { node: "pve2" }]
      if (path === "/cluster/status") {
        return [
          { type: "node", name: "pve1", ip: "10.100.5.1", online: 0 },
          { type: "node", name: "pve2", ip: "10.100.5.2", online: 1 },
        ]
      }
      if (path === "/nodes/pve1/network") throw new Error("host unreachable")
      if (path.endsWith("/network")) return [{ iface: "vmbr0", type: "bridge" }]

      return null
    })

    const ips = await discoverNodeIps(CONN_OPTS as any, "c-1")

    expect(upserts().get("pve1")!.update).toEqual({})
    expect(ips).toEqual(["10.42.0.101", "10.0.0.5"])
  })

  it("refreshes an older guess with the new one", async () => {
    findManyMock.mockResolvedValue([{ node: "pve1", ip: "10.100.5.9", ipVerified: false }])
    resolveMock.mockReturnValue({ ip: "10.100.5.1", verified: false })

    await discoverNodeIps(CONN_OPTS as any, "c-1")

    expect(upserts().get("pve1")!.update).toEqual({ ip: "10.100.5.1", ipVerified: false })
  })

  it("falls back to the default tenant when the connection row is missing", async () => {
    connFindUniqueMock.mockResolvedValue(null)

    await discoverNodeIps(CONN_OPTS as any, "c-gone")

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ tenantId: "default" }),
      })
    )
  })
})
