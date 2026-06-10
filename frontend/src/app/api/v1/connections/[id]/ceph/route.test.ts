import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn(async () => null),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: vi.fn(async () => ({ id: "c1", baseUrl: "https://h", apiToken: "t" })),
}))
const pveFetch = vi.fn()
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...args: unknown[]) => pveFetch(...args),
}))

import { GET } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

beforeEach(() => vi.clearAllMocks())

function mockCluster() {
  pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
    if (path === "/nodes") return [{ node: "pve1", status: "online" }]
    if (path.endsWith("/ceph/status")) {
      return {
        health: { status: "HEALTH_OK", checks: {} },
        mgrmap: { active_name: "pve1", standbys: [{ name: "pve2" }] },
        pgmap: {}, osdmap: {}, monmap: {},
      }
    }
    return [] // osd, mon, pool, mds, rules, fs
  })
}

describe("GET /api/v1/connections/[id]/ceph — managers", () => {
  it("derives managers (active + standbys with host) from status.mgrmap", async () => {
    mockCluster()
    const res = await callRoute(GET, { params: { id: "c1" } })
    expect(res.status).toBe(200)
    const json = await readJson<{ data: { managers: { active: { name: string; host: string }; standbys: { name: string; host: string }[] } } }>(res)
    expect(json?.data.managers.active).toEqual({ name: "pve1", host: "pve1" })
    expect(json?.data.managers.standbys).toEqual([{ name: "pve2", host: "pve2" }])
  })
})
