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

/*
   The cluster Ceph tab reads `_normalized.healthChecks` here. Each check
   carries its detail lines (ui#1164), so `host pve3 has flags noout` shows
   under the OSD_FLAGS warning.
*/

const STATUS = {
  health: {
    status: "HEALTH_WARN",
    checks: {
      OSD_FLAGS: {
        severity: "HEALTH_WARN",
        summary: { message: "1 OSDs or CRUSH {nodes, device-classes} have {NOUP,NODOWN,NOIN,NOOUT} flags set" },
        detail: [{ message: "host pve3 has flags noout" }],
      },
      MON_DISK_LOW: { severity: "HEALTH_WARN", message: "mons are low on available space" },
    },
  },
  osdmap: { osdmap: { num_osds: 3, num_up_osds: 3, num_in_osds: 2 } },
  fsmap: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
    if (path === "/nodes") return [{ node: "pve1" }]
    if (path.endsWith("/ceph/status")) return STATUS
    if (path.endsWith("/ceph/osd")) return { root: { children: [{ type: "osd", id: 0, status: "up", in: 1 }] } }
    if (path.endsWith("/ceph/mds")) return []
    throw new Error(`unexpected ${path}`)
  })
})

describe("GET /api/v1/connections/[id]/ceph/status", () => {
  it("normalises every health check with its summary and detail lines", async () => {
    const res = await callRoute(GET, { params: { id: "c1" } })
    expect(res.status).toBe(200)
    const json = await readJson<any>(res)
    expect(json.data._normalized.healthChecks).toEqual([
      {
        name: "OSD_FLAGS",
        severity: "HEALTH_WARN",
        summary: "1 OSDs or CRUSH {nodes, device-classes} have {NOUP,NODOWN,NOIN,NOOUT} flags set",
        detail: [{ message: "host pve3 has flags noout" }],
      },
      { name: "MON_DISK_LOW", severity: "HEALTH_WARN", summary: "mons are low on available space", detail: [] },
    ])
    expect(json.data._normalized.osd).toMatchObject({ num_osds: 3, num_up_osds: 3, num_in_osds: 2, list: [{ id: 0, up: true, in: true }] })
  })

  it("answers no data when the node has no Ceph", async () => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path === "/nodes") return [{ node: "pve1" }]
      throw new Error("500 not found")
    })
    const json = await readJson<any>(await callRoute(GET, { params: { id: "c1" } }))
    expect(json).toEqual({ data: null, message: "Ceph not configured" })
  })
})
