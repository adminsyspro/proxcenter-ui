import { describe, it, expect, vi, beforeEach } from "vitest"

// Provider or MSP tenant: the IaaS Ceph gate lets the caller through (its own tests: lib/ceph/tenantGuard*.test.ts).
vi.mock("@/lib/ceph/tenantGuard", () => ({ denyIaasTenantCeph: async () => null }))
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
    if (path.endsWith("/ceph/pool")) {
      return [{
        pool: "1", pool_name: "rbd", size: 3, min_size: 2,
        crush_rule: "0", crush_rule_name: "replicated_rule",
        autoscale_status: { crush_root_id: -1 }, percent_used: 0.07,
      }]
    }
    if (path.endsWith("/ceph/osd")) {
      return { root: { children: [
        { id: "0", name: "osd.0", type: "osd", status: "up", up: 1, in: 1, device_class: "hdd",
          crush_weight: 0.05, percent_used: 80, reweight: 1, pgs: 33, ceph_version_short: "19.2.3",
          apply_latency_ms: 1, commit_latency_ms: 2 },
      ] } }
    }
    return [] // mon, mds, rules, fs
  })
}

describe("GET /api/v1/connections/[id]/ceph — managers", () => {
  it("derives managers (active + standbys with host) from status.mgrmap", async () => {
    mockCluster()
    const res = await callRoute(GET, { params: { id: "c1" } })
    expect(res.status).toBe(200)
    const json = await readJson<{ data: { managers: { active: { name: string; host: string }; standbys: { name: string; host: string }[] } } }>(res)
    expect(json?.data.managers.active).toEqual({ name: "pve1", host: "pve1", version: null, addr: null })
    expect(json?.data.managers.standbys).toEqual([{ name: "pve2", host: "pve2", version: null, addr: null }])
  })

  it("matches a manager listed by its FQDN to the short name of the mgrmap", async () => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path.endsWith("/ceph/mgr")) return [{ name: "pve1.lab.local", ceph_version_short: "20.2.4", addr: "10.0.0.1" }]
      if (path.endsWith("/ceph/status")) return { health: { status: "HEALTH_OK", checks: {} }, mgrmap: { active_name: "pve1", standbys: [] }, pgmap: {}, osdmap: {}, monmap: {} }
      if (path === "/nodes") return [{ node: "pve1", status: "online" }]
      return []
    })
    const res = await callRoute(GET, { params: { id: "c1" } })
    const json = await readJson<{ data: { managers: { active: unknown } } }>(res)

    expect(json?.data.managers.active).toEqual({ name: "pve1", host: "pve1", version: "20.2.4", addr: "10.0.0.1" })
  })

  it("carries the version and address of monitors, managers and metadata servers when PVE reports them", async () => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path.endsWith("/ceph/mgr")) return [{ name: "pve1", ceph_version_short: "20.2.4", addr: "10.0.0.1" }, { name: "pve2", ceph_version_short: "19.2.1", addr: "10.0.0.2" }]
      if (path.endsWith("/ceph/mon")) return [{ name: "pve1", host: "pve1", addr: "10.0.0.1:6789/0", ceph_version_short: "20.2.4" }]
      if (path.endsWith("/ceph/mds")) return [{ name: "pve1", host: "pve1", addr: "10.0.0.1:6801/1", state: "up:active", ceph_version_short: "20.2.4" }]
      if (path.endsWith("/ceph/status")) return { health: { status: "HEALTH_OK", checks: {} }, mgrmap: { active_name: "pve1", standbys: [{ name: "pve2" }] }, pgmap: {}, osdmap: {}, monmap: {} }
      if (path === "/nodes") return [{ node: "pve1", status: "online" }]
      return []
    })
    const res = await callRoute(GET, { params: { id: "c1" } })
    const json = await readJson<{ data: { managers: { active: unknown; standbys: unknown[] }; monitors: { list: { version: string }[] }; mds: { list: { version: string }[] } } }>(res)

    expect(json?.data.managers.active).toEqual({ name: "pve1", host: "pve1", version: "20.2.4", addr: "10.0.0.1" })
    expect(json?.data.managers.standbys).toEqual([{ name: "pve2", host: "pve2", version: "19.2.1", addr: "10.0.0.2" }])
    expect(json?.data.monitors.list[0].version).toBe("20.2.4")
    expect(json?.data.mds.list[0].version).toBe("20.2.4")
  })

  it("exposes crushRuleName and crushRootId on pools (for the topology rule/target)", async () => {
    mockCluster()
    const res = await callRoute(GET, { params: { id: "c1" } })
    const json = await readJson<{ data: { pools: { list: Array<{ name: string; crushRuleName: string; crushRootId: number }> } } }>(res)
    const rbd = json?.data.pools.list.find((p) => p.name === "rbd")
    expect(rbd?.crushRuleName).toBe("replicated_rule")
    expect(rbd?.crushRootId).toBe(-1)
  })

  it("exposes reweight/pgs/version on osds (for the topology details panel)", async () => {
    mockCluster()
    const res = await callRoute(GET, { params: { id: "c1" } })
    const json = await readJson<{ data: { osds: { list: Array<{ name: string; reweight: number; pgs: number; version: string }> } } }>(res)
    const osd0 = json?.data.osds.list.find((o) => o.name === "osd.0")
    expect(osd0?.reweight).toBe(1)
    expect(osd0?.pgs).toBe(33)
    expect(osd0?.version).toBe("19.2.3")
  })

  it("reads used and free bytes from bytes_used and total_space when PVE gives no kb_used, and exposes the devices", async () => {
    const real = { id: "2", name: "osd.2", type: "osd", status: "up", up: 1, in: 1, host: "pve3", device_class: "hdd", osdtype: "bluestore",
      crush_weight: 0.097686767578125, bytes_used: 88265281536, total_space: 107369988096, percent_used: 82.2, reweight: 1, pgs: 129,
      blfsdev: "/dev/dm-0", dbdev: null, waldev: "/dev/sdc1" }
    const kb = { id: "3", name: "osd.3", type: "osd", status: "up", up: 1, in: 1, host: "pve3", device_class: "hdd", kb_used: 100, kb_avail: 300,
      bytes_used: 999, total_space: 999999, crush_weight: 1 }
    pveFetch.mockImplementation(async (_c: unknown, path: string) => {
      if (path === "/nodes") return [{ node: "pve1", status: "online" }, { node: "pve3", status: "online" }]
      if (path.endsWith("/ceph/status")) return { health: { status: "HEALTH_OK", checks: {} }, mgrmap: {}, pgmap: {}, osdmap: {}, monmap: {} }
      if (path.endsWith("/ceph/osd")) return { root: { children: [real, kb] } }
      return []
    })
    const res = await callRoute(GET, { params: { id: "c1" } })
    const json = await readJson<{ data: { pveNodes: string[]; osds: { list: Array<Record<string, unknown>> } } }>(res)
    const o2 = json?.data.osds.list.find((o) => o.name === "osd.2")
    const o3 = json?.data.osds.list.find((o) => o.name === "osd.3")

    expect(o2).toMatchObject({ usedBytes: 88265281536, availBytes: 107369988096 - 88265281536, osdType: "bluestore", dataDevice: "/dev/dm-0", dbDevice: null, walDevice: "/dev/sdc1" })
    expect(o3).toMatchObject({ usedBytes: 102400, availBytes: 307200 })
    expect(json?.data.pveNodes).toEqual(["pve1", "pve3"])
    expect((json?.data as unknown as { pveNodeStatus: Record<string, string> }).pveNodeStatus).toEqual({ pve1: "online", pve3: "online" })
  })

  it("handles a cluster with no active mgr (managers.active null, standbys [])", async () => {
    pveFetch.mockImplementation(async (_c: unknown, path: string) => {
      if (path === "/nodes") return [{ node: "pve1", status: "online" }]
      if (path.endsWith("/ceph/status")) return { health: { status: "HEALTH_OK", checks: {} }, mgrmap: {}, pgmap: {}, osdmap: {}, monmap: {} }
      return []
    })
    const res = await callRoute(GET, { params: { id: "c1" } })
    const json = await readJson<{ data: { managers: { active: unknown; standbys: unknown[] } } }>(res)
    expect(json?.data.managers.active).toBeNull()
    expect(json?.data.managers.standbys).toEqual([])
  })
})

describe("GET /api/v1/connections/[id]/ceph, stopped daemons", () => {
  // Lab, PVE 9 / Ceph 20: mgr.pve3 stopped, the mgrmap no longer knows it, PVE still lists it.
  const LAB_MGRS = [
    { addr: "10.42.0.102", host: "pve2", name: "pve2", state: "standby", ceph_version_short: "20.2.4" },
    { addr: "10.42.0.101", host: "pve1", name: "pve1", state: "active", ceph_version_short: "20.2.4" },
    { direxists: true, host: "pve3", name: "pve3", service: true, state: "stopped" },
  ]

  function cluster(opts: { mgrs?: unknown; mgrmap?: unknown; mons?: unknown[]; mds?: unknown[] }) {
    pveFetch.mockImplementation(async (_c: unknown, path: string) => {
      if (path === "/nodes") return [{ node: "pve1", status: "online" }, { node: "pve2", status: "online" }, { node: "pve3", status: "online" }]
      if (path.endsWith("/ceph/status")) return { health: { status: "HEALTH_OK", checks: {} }, mgrmap: opts.mgrmap ?? { active_name: "pve1", standbys: [{ name: "pve2" }] }, pgmap: {}, osdmap: {}, monmap: {} }
      if (path.endsWith("/ceph/mgr")) {
        if (opts.mgrs instanceof Error) throw opts.mgrs

        return opts.mgrs ?? LAB_MGRS
      }
      if (path.endsWith("/ceph/mon")) return opts.mons ?? []
      if (path.endsWith("/ceph/mds")) return opts.mds ?? []
      return []
    })
  }

  type Managers = { active: { name: string } | null; standbys: { name: string }[]; stopped: { name: string; host: string; version: string | null; addr: string | null }[] }
  const managersOf = async () => (await readJson<{ data: { managers: Managers } }>(await callRoute(GET, { params: { id: "c1" } })))?.data.managers as Managers

  it("lists a manager PVE reports stopped, absent from the mgrmap, and keeps the active and the standbys as they were", async () => {
    cluster({})
    const m = await managersOf()

    expect(m.stopped).toEqual([{ name: "pve3", host: "pve3", version: null, addr: null }])
    expect(m.active).toMatchObject({ name: "pve1", host: "pve1", version: "20.2.4", addr: "10.42.0.101" })
    expect(m.standbys).toEqual([{ name: "pve2", host: "pve2", version: "20.2.4", addr: "10.42.0.102" }])
  })

  it("lists a PVE manager the mgrmap does not carry even when PVE gives no state", async () => {
    cluster({ mgrs: [{ name: "pve1" }, { name: "pve2" }, { name: "pve3" }] })
    expect((await managersOf()).stopped.map((g) => g.name)).toEqual(["pve3"])
  })

  it("does not list a manager twice when the mgrmap still carries one PVE reports stopped", async () => {
    cluster({ mgrmap: { active_name: "pve1", standbys: [{ name: "pve2" }, { name: "pve3" }] } })
    const m = await managersOf()

    expect(m.stopped.map((g) => g.name)).toEqual(["pve3"])
    expect(m.standbys.map((g) => g.name)).toEqual(["pve2"])
    expect(m.active?.name).toBe("pve1")
  })

  it("lists nothing as stopped when every manager is in the mgrmap, FQDN or not", async () => {
    cluster({ mgrs: [{ name: "pve1.lab.local", state: "active" }, { name: "pve2", state: "standby" }] })
    const m = await managersOf()

    expect(m.stopped).toEqual([])
    expect(m.active?.name).toBe("pve1")
    expect(m.standbys.map((g) => g.name)).toEqual(["pve2"])
  })

  it("keeps the behaviour of before when the PVE manager list fails: no stopped manager, mgrmap managers unchanged", async () => {
    cluster({ mgrs: new Error("500 boom") })
    const m = await managersOf()

    expect(m.stopped).toEqual([])
    expect(m.active?.name).toBe("pve1")
    expect(m.standbys.map((g) => g.name)).toEqual(["pve2"])
  })

  it("does not call every manager stopped when there is no mgrmap to compare to, only those PVE reports stopped", async () => {
    cluster({ mgrmap: {} })
    const m = await managersOf()

    expect(m.active).toBeNull()
    expect(m.stopped.map((g) => g.name)).toEqual(["pve3"])
  })

  it("carries the PVE state of a monitor and of a metadata server, a stopped one staying in the list", async () => {
    cluster({
      mons: [{ name: "pve1", host: "pve1", state: "running" }, { name: "pve3", host: "pve3", state: "stopped" }],
      mds: [{ name: "pve1", host: "pve1", state: "up:active", rank: 0 }, { name: "pve3", host: "pve3", state: "stopped" }],
    })
    const json = await readJson<{ data: { monitors: { list: { name: string; state: string | null }[] }; mds: { list: { name: string; state: string }[] } } }>(await callRoute(GET, { params: { id: "c1" } }))

    expect(json?.data.monitors.list.map((m) => [m.name, m.state])).toEqual([["pve1", "running"], ["pve3", "stopped"]])
    expect(json?.data.mds.list.map((m) => [m.name, m.state])).toEqual([["pve1", "up:active"], ["pve3", "stopped"]])
  })
})

describe("GET /api/v1/connections/[id]/ceph, pool PG figures on the real PVE shape", () => {
  it("reads the PG target from autoscale_status and exposes the autoscaler recommendation", async () => {
    mockCluster()
    const base = pveFetch.getMockImplementation()!
    pveFetch.mockImplementation(async (conn: unknown, path: string) => {
      if (path.endsWith("/ceph/pool")) {
        return [{
          pool: 2, pool_name: "CephStoragePool", size: 3, min_size: 2, type: "replicated", crush_rule: 0, crush_rule_name: "replicated_rule",
          pg_num: 128, pg_num_final: 64, pg_num_min: null, pg_autoscale_mode: "on", bytes_used: 261393696780, percent_used: 0.8638,
          autoscale_status: { crush_root_id: -1, pg_num_target: 128, pg_num_ideal: 81, pg_num_final: 64 },
        }]
      }
      return base(conn, path)
    })
    const res = await callRoute(GET, { params: { id: "c1" } })
    const json = await readJson<{ data: { pools: { list: Array<{ pgNum: number; pgNumTarget: number; pgNumIdeal: number; pgNumFinal: number }> } } }>(res)
    const p = json?.data.pools.list[0]
    expect(p).toMatchObject({ pgNum: 128, pgNumTarget: 128, pgNumIdeal: 81, pgNumFinal: 64 })
  })

  it("falls back to a root pg_num_target, then to pg_num", async () => {
    mockCluster()
    const base = pveFetch.getMockImplementation()!
    pveFetch.mockImplementation(async (conn: unknown, path: string) => {
      if (path.endsWith("/ceph/pool")) {
        return [
          { pool: 1, pool_name: "a", pg_num: 32, pg_num_target: 64, autoscale_status: {} },
          { pool: 2, pool_name: "b", pg_num: 32 },
        ]
      }
      return base(conn, path)
    })
    const res = await callRoute(GET, { params: { id: "c1" } })
    const json = await readJson<{ data: { pools: { list: Array<{ name: string; pgNumTarget: number; pgNumIdeal: number | null }> } } }>(res)
    expect(json?.data.pools.list.map(p => p.pgNumTarget)).toEqual([64, 32])
    expect(json?.data.pools.list[1].pgNumIdeal).toBeNull()
  })
})

describe("GET /api/v1/connections/[id]/ceph, generic error", () => {
  it("500 without the PVE message, the log gets it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    pveFetch.mockRejectedValue(new Error("PVE 500 /nodes/pve1/ceph/status: connect to 10.42.0.101 failed"))
    const res = await callRoute(GET, { params: { id: "c1" } })
    expect(res.status).toBe(500)
    const raw = JSON.stringify(await readJson<any>(res))
    expect(raw).not.toContain("pve1")
    expect(raw).not.toContain("10.42.0.101")
    expect(spy.mock.calls.flat().join(" ")).toContain("10.42.0.101")
    spy.mockRestore()
  })

  it("reads /nodes/{n}/status only for the nodes that carry a monitor and exposes the free space of each (rootfs, the base of Ceph)", async () => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path === "/nodes") return [{ node: "pve1", status: "online" }, { node: "pve2", status: "online" }, { node: "pve3", status: "online" }]
      if (path.endsWith("/ceph/mon")) return [{ name: "pve1", host: "pve1" }, { name: "pve2", host: "pve2" }]
      if (path.endsWith("/ceph/status")) return { health: { status: "HEALTH_OK", checks: {} }, pgmap: {}, osdmap: {}, monmap: {} }
      if (path === "/nodes/pve1/status") return { rootfs: { total: 100e9, avail: 3.4e9, used: 90e9 } }
      if (path === "/nodes/pve2/status") return { rootfs: { total: 200e9, avail: 28e9 } }
      return []
    })
    const res = await callRoute(GET, { params: { id: "c1" } })
    const json = await readJson<{ data: { monDisk: unknown[] } }>(res)
    const statusCalls = pveFetch.mock.calls.map(c => c[1] as string).filter(p => /^\/nodes\/[^/]+\/status$/.test(p)).sort()

    expect(statusCalls).toEqual(["/nodes/pve1/status", "/nodes/pve2/status"])
    expect(json?.data.monDisk).toEqual([
      { mon: "pve1", node: "pve1", availBytes: 3.4e9, totalBytes: 100e9, availPct: 3.4 },
      { mon: "pve2", node: "pve2", availBytes: 28e9, totalBytes: 200e9, availPct: 14 },
    ])
  })

  it("leaves out the monitor whose node cannot be read, without failing the inventory", async () => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path === "/nodes") return [{ node: "pve1", status: "online" }, { node: "pve2", status: "offline" }]
      if (path.endsWith("/ceph/mon")) return [{ name: "pve1", host: "pve1" }, { name: "pve2", host: "pve2" }]
      if (path.endsWith("/ceph/status")) return { health: { status: "HEALTH_OK", checks: {} }, pgmap: {}, osdmap: {}, monmap: {} }
      if (path === "/nodes/pve1/status") return { rootfs: { total: 100e9, avail: 50e9 } }
      if (path === "/nodes/pve2/status") throw new Error("595 no route to host")
      return []
    })
    const res = await callRoute(GET, { params: { id: "c1" } })
    const json = await readJson<{ data: { monDisk: { mon: string }[]; monitors: { list: unknown[] } } }>(res)

    expect(res.status).toBe(200)
    expect(json?.data.monDisk.map(m => m.mon)).toEqual(["pve1"])
    expect(json?.data.monitors.list).toHaveLength(2)
  })

  it("calls /status only for online nodes and finds the node of a monitor named with its FQDN", async () => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path === "/nodes") return [{ node: "pve1", status: "online" }, { node: "pve2", status: "offline" }]
      if (path.endsWith("/ceph/mon")) return [{ name: "pve1.lab.local", host: "pve1.lab.local" }, { name: "pve2", host: "pve2" }]
      if (path.endsWith("/ceph/status")) return { health: { status: "HEALTH_OK", checks: {} }, pgmap: {}, osdmap: {}, monmap: {} }
      if (path === "/nodes/pve1/status") return { rootfs: { total: 100e9, avail: 50e9 } }
      return []
    })
    const res = await callRoute(GET, { params: { id: "c1" } })
    const json = await readJson<{ data: { monDisk: { mon: string; node: string }[] } }>(res)
    const statusCalls = pveFetch.mock.calls.map(c => c[1] as string).filter(p => /^\/nodes\/[^/]+\/status$/.test(p))

    expect(statusCalls).toEqual(["/nodes/pve1/status"])
    expect(json?.data.monDisk.map(m => [m.mon, m.node])).toEqual([["pve1.lab.local", "pve1"]])
  })

  it("does not expose a muted check", async () => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path === "/nodes") return [{ node: "pve1", status: "online" }]
      if (path.endsWith("/ceph/status")) return { health: { status: "HEALTH_OK", checks: { OLD: { severity: "HEALTH_WARN", summary: { message: "x" }, muted: true }, NEW: { severity: "HEALTH_WARN", summary: { message: "y" } } } }, pgmap: {}, osdmap: {}, monmap: {} }
      return []
    })
    const res = await callRoute(GET, { params: { id: "c1" } })
    const json = await readJson<{ data: { health: { checks: { name: string }[] } } }>(res)

    expect(json?.data.health.checks.map(c => c.name)).toEqual(["NEW"])
  })
})
