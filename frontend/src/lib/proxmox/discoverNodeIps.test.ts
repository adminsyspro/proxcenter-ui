import { beforeEach, describe, expect, it, vi } from "vitest"

// Hoist mocks so they are available in vi.mock factories
const { pveFetchMock, upsertMock, deleteManyMock, connFindUniqueMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  upsertMock: vi.fn().mockResolvedValue({}),
  deleteManyMock: vi.fn().mockResolvedValue({ count: 0 }),
  connFindUniqueMock: vi.fn(),
}))

vi.mock("./client", () => ({ pveFetch: pveFetchMock }))
// Faithful to the real helper: no interfaces means no management IP. A mock
// that answers regardless of its input cannot express a node that stopped
// answering, which is the case under test below.
vi.mock("./resolveManagementIp", () => ({
  resolveManagementIp: (networks: any) => (Array.isArray(networks) && networks.length > 0 ? "10.0.0.5" : null),
}))
vi.mock("../cache/nodeIpCache", () => ({ setNodeIps: vi.fn() }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findUnique: connFindUniqueMock },
    managedHost: { upsert: upsertMock, deleteMany: deleteManyMock },
  },
}))

import { discoverNodeIps } from "./discoverNodeIps"

const CONN_OPTS = { baseUrl: "https://10.0.0.1:8006", apiToken: "t", insecureDev: false }

beforeEach(() => {
  vi.clearAllMocks()
  upsertMock.mockResolvedValue({})
  deleteManyMock.mockResolvedValue({ count: 0 })
  connFindUniqueMock.mockResolvedValue({ tenantId: "msp-1" })
  // Routed by path rather than by call order: discovery now also asks
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
        create: expect.objectContaining({ connectionId: "c-msp", tenantId: "msp-1" }),
      })
    )
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

    const byNode = new Map(
      upsertMock.mock.calls.map(c => [c[0].where.connectionId_node.node, c[0]]),
    )

    // The dead node keeps whatever address is on file.
    expect(byNode.get("pve1")!.update).toEqual({})

    // The live one is still refreshed.
    expect(byNode.get("pve2")!.update).toEqual({ ip: "10.0.0.5" })
  })

  // /cluster/status reports a member's IP even when that member is offline, so
  // it recovers the address the per-node lookup could not reach.
  it("falls back to cluster status for an offline node", async () => {
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
    expect(ips).toContain("10.0.0.1")

    const written = upsertMock.mock.calls.map(c => c[0].update.ip).filter(Boolean)

    expect(written).toContain("10.0.0.1")
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
