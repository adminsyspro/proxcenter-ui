import { describe, it, expect, vi, beforeEach } from "vitest"

// RBAC allows; the route gates on NODE_VIEW.
vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn(async () => null),
  PERMISSIONS: { NODE_VIEW: "node.view" },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: vi.fn(async () => ({ id: "c1", host: "h", tokenId: "t", tokenSecret: "s" })),
}))
const pveFetch = vi.fn()
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...args: unknown[]) => pveFetch(...args),
}))

import { GET } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const RAW_CONF = [
  "[global]",
  "\tauth_client_required = cephx",
  "\tfsid = af66e363-d2df-4b2f-b25f-933a148224d5",
  "\tmon_host = 10.0.0.1 10.0.0.2",
  "\tosd_pool_default_size = 3",
  "",
  "[client.crash]",
  "\tkeyring = /etc/pve/ceph/$cluster.$name.keyring",
  "",
  "[mon.pve1]",
  "\tpublic_addr = 10.0.0.1",
].join("\n")

const CONFIG_DB = [
  { section: "global", name: "mon_allow_pool_delete", value: "true", level: "advanced" },
  { section: "mgr", name: "mgr/balancer/active", value: "true", level: "advanced" },
]

function mockPve(opts: { rawConfig?: string | Error; configDb?: unknown[] | Error } = {}) {
  pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
    if (path.endsWith("/ceph/status")) {
      return { health: { status: "HEALTH_OK" }, monmap: { fsid: "abc", mons: [{ addr: "10.0.0.1:6789/0" }] } }
    }
    if (path.endsWith("/ceph/cfg/raw")) {
      if (opts.rawConfig instanceof Error) throw opts.rawConfig
      return opts.rawConfig ?? RAW_CONF
    }
    if (path.endsWith("/ceph/cfg/db")) {
      if (opts.configDb instanceof Error) throw opts.configDb
      return opts.configDb ?? CONFIG_DB
    }
    if (path.endsWith("/ceph/crush")) return "crush-map-text"
    return null
  })
}

type CephResp = {
  data: {
    hasCeph: boolean
    config?: { raw: string | null; global: Record<string, unknown>; database: unknown[]; crushMap: unknown }
  }
}

beforeEach(() => vi.clearAllMocks())

describe("GET /api/v1/connections/[id]/nodes/[node]/ceph — config section", () => {
  it("returns the full ceph.conf and the config database from the real PVE endpoints", async () => {
    mockPve()
    const res = await callRoute(GET, { params: { id: "c1", node: "pve1" }, searchParams: { section: "config" } })
    expect(res.status).toBe(200)

    // It must hit the real endpoints, not fabricate from /ceph/status.
    const paths = pveFetch.mock.calls.map((c) => c[1] as string)
    expect(paths).toContain("/nodes/pve1/ceph/cfg/raw")
    expect(paths).toContain("/nodes/pve1/ceph/cfg/db")

    const json = await readJson<CephResp>(res)
    // Raw file is returned verbatim (every section + key, not just fsid/mon_host).
    expect(json?.data.config?.raw).toBe(RAW_CONF)
    expect(json?.data.config?.raw).toContain("osd_pool_default_size = 3")
    expect(json?.data.config?.raw).toContain("[client.crash]")
    // Config database is populated from /ceph/cfg/db.
    expect(json?.data.config?.database).toEqual(CONFIG_DB)
  })

  it("falls back to the status-derived view with UNBRACKETED section keys when the raw file is unavailable", async () => {
    mockPve({ rawConfig: new Error("PVE 403"), configDb: new Error("PVE 403") })
    const res = await callRoute(GET, { params: { id: "c1", node: "pve1" }, searchParams: { section: "config" } })
    expect(res.status).toBe(200)

    const json = await readJson<CephResp>(res)
    expect(json?.data.config?.raw).toBeNull()
    // Section keys carry NO brackets (the renderer adds them) — guards the [[global]] regression.
    const sections = Object.keys(json?.data.config?.global ?? {})
    expect(sections).toContain("global")
    expect(sections).toContain("client")
    expect(sections).not.toContain("[global]")
    // Database degrades to an empty list rather than throwing.
    expect(json?.data.config?.database).toEqual([])
  })

  it("reports hasCeph:false when Ceph is not installed on the node", async () => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path.endsWith("/ceph/status")) throw new Error("PVE 500 ceph not installed")
      return null
    })
    const res = await callRoute(GET, { params: { id: "c1", node: "pve1" }, searchParams: { section: "config" } })
    expect(res.status).toBe(200)
    const json = await readJson<{ hasCeph: boolean }>(res)
    expect(json?.hasCeph).toBe(false)
  })
})
