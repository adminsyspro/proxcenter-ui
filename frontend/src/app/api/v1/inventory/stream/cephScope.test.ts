/**
 * GET /api/v1/inventory/stream: the Ceph health of a shared provider cluster
 * is never read nor sent to an IaaS tenant; the provider and an MSP tenant
 * keep it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { NextRequest } from "next/server"

const { pveFetchMock, findManyMock, tenantMock, infraMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  findManyMock: vi.fn(),
  tenantMock: vi.fn(),
  infraMock: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: async () => tenantMock(),
  getSessionPrisma: async () => ({ connection: { findMany: findManyMock } }),
  DEFAULT_TENANT_ID: "default",
}))
vi.mock("@/lib/vdc/context", () => ({ getVdcContext: async () => null }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: async () => infraMock(),
}))
vi.mock("@/lib/rbac", async (orig) => ({
  ...(await orig<typeof import("@/lib/rbac")>()),
  checkPermission: async () => null,
  getRBACContext: async () => ({ isAdmin: true, userId: "admin", tenantId: tenantMock() }),
  getRbacInfraScope: async () => null,
  filterVmsByPermission: async (_u: string, vms: any[]) => vms,
}))
vi.mock("@/lib/demo/demo-api", () => ({ demoResponse: () => null }))
vi.mock("@/lib/db/prisma", () => ({ prisma: { connection: { findMany: findManyMock } } }))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: async (id: string) => ({ id }),
  getPbsConnectionByIdUnscoped: async (id: string) => ({ id }),
}))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock("@/lib/proxmox/pbs-client", () => ({ pbsFetch: async () => { throw new Error("PBS offline in this test") } }))

import { invalidateInventoryCache } from "@/lib/cache/inventoryCache"

import { GET } from "./route"

async function clusters(): Promise<any[]> {
  const res = await GET(new NextRequest("http://test.local/api/v1/inventory/stream"))
  const out: any[] = []
  for (const chunk of (await res.text()).split("\n\n")) {
    const lines = chunk.split("\n")
    if (lines.find(l => l.startsWith("event: "))?.slice(7) !== "cluster") continue
    out.push(JSON.parse(lines.find(l => l.startsWith("data: "))!.slice(6)))
  }
  return out
}

const cephCalls = () => pveFetchMock.mock.calls.filter(([, path]) => String(path).includes("ceph"))

function iaasScope() {
  return {
    connectionIds: new Set(["connA"]),
    pbsConnectionIds: new Set<string>(),
    nodesByConnection: new Map([["connA", new Set(["n1"])]]),
    storagesByConnection: new Map(),
    writableStoragesByConnection: new Map(),
    isoLibrariesByConnection: new Map(),
    uploadLibrariesByConnection: new Map(),
    storagePoliciesByConnection: new Map(),
    poolsByConnection: new Map([["connA", new Set(["pool-a"])]]),
    vnetsByConnection: new Map(),
    sharedBridgesByConnection: new Map(),
    pbsNamespacesByConnection: new Map(),
    pbsNamespacesByPveConnection: new Map(),
  }
}

beforeEach(() => {
  invalidateInventoryCache()
  findManyMock.mockReset().mockImplementation(async ({ where }: any) => {
    if (where?.type === "pve") return [{ id: "connA", name: "Shared", type: "pve", tenantId: "default" }]
    return []
  })
  pveFetchMock.mockReset().mockImplementation(async (_conn: any, path: string) => {
    if (path === "/nodes") return [{ node: "n1", status: "online" }, { node: "n2", status: "online" }]
    if (path === "/cluster/ceph/status") return { health: { status: "HEALTH_WARN" } }
    return []
  })
})

describe("inventory stream: Ceph health of a shared cluster", () => {
  it("iaas: /cluster/ceph/status is never called and the cluster carries no cephHealth", async () => {
    tenantMock.mockReturnValue("tenant-iaas")
    infraMock.mockReturnValue({ kind: "iaas", vdcScope: iaasScope() })

    const out = await clusters()

    expect(out.map(c => c.id)).toEqual(["connA"])
    expect(out[0]).not.toHaveProperty("cephHealth")
    expect(cephCalls()).toEqual([])
  })

  it("provider: the cluster keeps its cephHealth", async () => {
    tenantMock.mockReturnValue("default")
    infraMock.mockReturnValue({ kind: "provider" })

    const out = await clusters()

    expect(out[0].cephHealth).toBe("HEALTH_WARN")
  })

  it("msp: its own cluster keeps its cephHealth", async () => {
    tenantMock.mockReturnValue("tenant-msp")
    infraMock.mockReturnValue({ kind: "msp", connectionIds: new Set(["connA"]) })

    const out = await clusters()

    expect(out[0].cephHealth).toBe("HEALTH_WARN")
  })
})
