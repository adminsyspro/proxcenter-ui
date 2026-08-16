import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn(async () => null),
  PERMISSIONS: { NODE_VIEW: "node.view" },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: vi.fn(async () => ({ id: "c1", baseUrl: "https://h", apiToken: "t" })),
}))
vi.mock("@/lib/demo/demo-api", () => ({
  demoResponse: vi.fn(() => null),
}))
const pveFetch = vi.fn()
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...args: unknown[]) => pveFetch(...args),
}))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

beforeEach(() => vi.clearAllMocks())

type Point = { ts: number; cpu: number; ram: number; arc: number | null; arcPct: number | null }

const GIB = 1024 * 1024 * 1024

async function trendsFor(rrd: Record<string, number>[]) {
  pveFetch.mockResolvedValue(rrd)

  const res = await callRoute(POST, {
    params: { id: "c1" },
    body: { items: [{ node: "pve1" }], timeframe: "hour" },
  })

  expect(res.status).toBe(200)
  const json = await readJson<{ data: Record<string, Point[]> }>(res)

  return json?.data["node:pve1"] ?? []
}

describe("POST /api/v1/connections/[id]/nodes/trends — ZFS ARC (#617)", () => {
  it("exposes arcsize in bytes and as a share of the node memory", async () => {
    const points = await trendsFor([
      { time: 1_700_000_000, cpu: 0.1, mem: 4 * GIB, maxmem: 32 * GIB, arcsize: 8 * GIB },
    ])

    expect(points[0].arc).toBe(8 * GIB)
    expect(points[0].arcPct).toBe(25)
  })

  it("reports null on a PVE 8 node, whose RRD has no arcsize column at all", async () => {
    const points = await trendsFor([
      { time: 1_700_000_000, cpu: 0.1, mem: 4 * GIB, maxmem: 32 * GIB },
    ])

    expect(points[0].arc).toBeNull()
    expect(points[0].arcPct).toBeNull()

    // The pre-existing metrics must keep their exact shape.
    expect(points[0].cpu).toBe(10)
    expect(points[0].ram).toBe(13)
  })

  it("reports null rather than zero on a node without ZFS", async () => {
    const points = await trendsFor([
      { time: 1_700_000_000, cpu: 0.1, mem: 4 * GIB, maxmem: 32 * GIB, arcsize: 0 },
    ])

    expect(points[0].arc).toBeNull()
    expect(points[0].arcPct).toBeNull()
  })

  it("leaves arcPct null when the node reports no total memory", async () => {
    const points = await trendsFor([
      { time: 1_700_000_000, cpu: 0.1, mem: 0, maxmem: 0, arcsize: 2 * GIB },
    ])

    expect(points[0].arc).toBe(2 * GIB)
    expect(points[0].arcPct).toBeNull()
  })
})
