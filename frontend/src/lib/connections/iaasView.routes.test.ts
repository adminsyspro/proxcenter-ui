import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

// roadmap#189: the connection routes the tenant screens need answer an IaaS
// tenant with its own share of the provider cluster, through the real gate
// (lib/tenant/iaasGuard) and the views of ./iaasView. The provider keeps
// the full answer.
const h = vi.hoisted(() => ({
  getPrincipal: vi.fn(),
  scope: vi.fn(),
  pveFetch: vi.fn(),
  guestGuard: vi.fn(),
  sdnOwnVnets: vi.fn(),
}))

vi.mock("@/lib/auth/principal", () => ({
  getPrincipal: (...a: any[]) => h.getPrincipal(...a),
  rejectionToResponse: (r: any) => new Response(JSON.stringify(r?.body ?? {}), { status: r?.status ?? 401 }),
}))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getTenantInfrastructureScope: (...a: any[]) => h.scope(...a),
}))
vi.mock("@/lib/tenant", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  userHasAccessToTenant: async () => true,
  getCurrentTenantId: async () => "tenant-x",
  getSessionPrisma: async () => new Proxy({}, { get: () => new Proxy({}, { get: () => async () => [] }) }),
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, model) => new Proxy({}, { get: () => async () => (String(model) === "tenant" ? { enabled: true } : []) }) }),
}))
vi.mock("@/lib/rbac", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  checkPermission: async () => null,
  getCurrentRbacInfraScope: async () => null,
  getRBACContext: async () => ({ userId: "u1", tenantId: "tenant-x", isAdmin: false }),
  hasPermission: async () => true,
  guestPerimeterAllows: async () => true,
}))
vi.mock("@/lib/connections/getConnection", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getConnectionById: async (id: string) => ({ id, name: "PVE-PROD", baseUrl: "https://10.0.0.1:8006", apiToken: "t", tenantId: "default" }),
}))
vi.mock("@/lib/proxmox/client", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  pveFetch: (...a: any[]) => h.pveFetch(...a),
}))
vi.mock("@/lib/vdc/guestGuard", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  guardSessionGuest: (...a: any[]) => h.guestGuard(...a),
}))
vi.mock("@/lib/vdc/sdnReadScope", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sdnOwnVnets: (...a: any[]) => h.sdnOwnVnets(...a),
}))
vi.mock("@/lib/storage/storageVisibility", () => ({
  resolveStorageCaller: async () => ({ allowed: true }),
  storageVisibilityFilter: async () => () => true,
}))
vi.mock("@/lib/ceph/tenantGuard", () => ({ cephAllowedForCaller: async () => false }))
vi.mock("@/lib/audit/withAudit", () => ({ withAudit: (_o: unknown, handler: unknown) => handler }))
vi.mock("@/lib/api-tokens/routeGuard", () => ({ withPublicApiGuard: (_id: unknown, handler: unknown) => handler }))

const IAAS = { ok: true, principal: { kind: "session", userId: "u1", tenantId: "tenant-iaas", connectionIds: null } }
const PROVIDER = { ok: true, principal: { kind: "session", userId: "u1", tenantId: "default", connectionIds: null } }
const VDC = {
  connectionIds: new Set(["c1"]),
  pbsConnectionIds: new Set<string>(),
  nodesByConnection: new Map([["c1", new Set(["pve2"])]]),
  poolsByConnection: new Map([["c1", new Set(["vdc-acme"])]]),
}

const PVE: Record<string, unknown> = {
  "/nodes": [
    { node: "pve1", status: "online", maxcpu: 8, ssl_fingerprint: "F1" },
    { node: "pve2", status: "online", maxcpu: 8, ssl_fingerprint: "F2", level: "c" },
  ],
  "/nodes/pve2/status": { cpuinfo: { cpus: 8, cores: 8, sockets: 1, model: "Xeon" }, pveversion: "pve-manager/9.2", kversion: "Linux 7", memory: { total: 2, used: 1 } },
  "/cluster/options": { "tag-style": "shape=circle", keyboard: "fr", "allowed-tags": ["acme", "globex"] },
  "/pools": [{ poolid: "vdc-acme", comment: "a" }, { poolid: "vdc-globex", comment: "g" }, { poolid: "docs" }],
  "/cluster/mapping/pci": [{ id: "gpu", map: ["node=pve2,path=0000:01:00.0"] }, { id: "pve1-only", map: ["node=pve1,path=0000:02:00.0"] }],
  "/cluster/sdn/zones?pending=1": [{ zone: "z1", type: "vxlan", peers: "10.0.0.1,10.0.0.2" }],
  "/cluster/sdn/vnets?pending=1": [{ vnet: "v1", zone: "z1" }],
}

const iaas = () => {
  h.getPrincipal.mockResolvedValue(IAAS)
  h.scope.mockResolvedValue({ kind: "iaas", vdcScope: VDC })
}
const provider = () => {
  h.getPrincipal.mockResolvedValue(PROVIDER)
  h.scope.mockResolvedValue({ kind: "provider" })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as any).__proxcenter_nodes_response_cache__ = new Map()
  h.guestGuard.mockResolvedValue(null)
  h.sdnOwnVnets.mockResolvedValue(null)
  h.pveFetch.mockImplementation(async (_c: unknown, path: string) => {
    if (path.endsWith("/network")) return [{ iface: "vmbr0", type: "bridge", address: "10.0.0.2", gateway: "10.0.0.254" }]
    if (path.includes("rrddata")) return [{ time: 1, cpu: 0.1 }]
    if (path.startsWith("/cluster/resources")) return []
    return PVE[path] ?? []
  })
})

const get = async (load: () => Promise<any>, params: Record<string, string>, searchParams?: Record<string, string>) => {
  const mod = await load()
  const res = await callRoute(mod.GET, { method: "GET", params, searchParams })
  return { status: res.status, body: await res.json() }
}

describe("/nodes", () => {
  const load = () => import("@/app/api/v1/connections/[id]/nodes/route")

  it("iaas: its vDC nodes only, with the placement capacity, no address, certificate or API node", async () => {
    iaas()
    const { status, body } = await get(load, { id: "c1" })
    expect(status).toBe(200)
    expect(body.data.map((n: any) => n.node)).toEqual(["pve2"])
    expect(body.data[0]).not.toHaveProperty("ip")
    expect(body.data[0]).not.toHaveProperty("ssl_fingerprint")
    expect(body.data[0]).not.toHaveProperty("sshAddress")
    expect(body.data[0]).not.toHaveProperty("bridges")
    expect(body.data[0]).not.toHaveProperty("pveversion")
    expect(body.data[0]).toMatchObject({ node: "pve2", status: "online", maxcpu: 8, mem: 1, maxmem: 2 })
    expect(body.connectedNode).toBeNull()
  })

  it("provider: every node with its address", async () => {
    provider()
    const { body } = await get(load, { id: "c1" })
    expect(body.data.map((n: any) => n.node)).toEqual(["pve1", "pve2"])
    expect(body.data[1]).toHaveProperty("ip")
    expect(body.data[1]).toHaveProperty("ssl_fingerprint", "F2")
  })
})

describe("/nodes/{node}/status", () => {
  const load = () => import("@/app/api/v1/connections/[id]/nodes/[node]/status/route")

  it("iaas: the CPU topology of a vDC node", async () => {
    iaas()
    const { status, body } = await get(load, { id: "c1", node: "pve2" })
    expect(status).toBe(200)
    expect(body.data).toEqual({ cpuinfo: { cpus: 8, cores: 8, sockets: 1 } })
  })

  it("iaas: 404 for a node outside its vDC, without asking Proxmox", async () => {
    iaas()
    const { status } = await get(load, { id: "c1", node: "pve1" })
    expect(status).toBe(404)
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it("provider: the full status", async () => {
    provider()
    const { body } = await get(load, { id: "c1", node: "pve2" })
    expect(body.data).toEqual(PVE["/nodes/pve2/status"])
  })
})

describe("/cluster/options, /pools, /cluster/mapping", () => {
  it("options: the tag style only for iaas, everything for the provider", async () => {
    const load = () => import("@/app/api/v1/connections/[id]/cluster/options/route")
    iaas()
    expect((await get(load, { id: "c1" })).body.data).toEqual({ "tag-style": "shape=circle" })
    provider()
    expect((await get(load, { id: "c1" })).body.data).toEqual(PVE["/cluster/options"])
  })

  it("pools: the vDC pools only for iaas, as a restricted list", async () => {
    const load = () => import("@/app/api/v1/connections/[id]/pools/route")
    iaas()
    const own = (await get(load, { id: "c1" })).body
    expect(own).toEqual({ data: [{ poolid: "vdc-acme", comment: "a" }], restricted: true })
    provider()
    expect((await get(load, { id: "c1" })).body.data.map((p: any) => p.poolid)).toEqual(["vdc-acme", "vdc-globex", "docs"])
  })

  it("mapping: the mappings of its vDC nodes, without device addresses; 404 for a foreign node", async () => {
    const load = () => import("@/app/api/v1/connections/[id]/cluster/mapping/[kind]/route")
    iaas()
    expect((await get(load, { id: "c1", kind: "pci" })).body.data).toEqual([{ id: "gpu", map: ["node=pve2"] }])
    expect((await get(load, { id: "c1", kind: "pci" }, { node: "pve1" })).status).toBe(404)
    provider()
    expect((await get(load, { id: "c1", kind: "pci" })).body.data).toEqual(PVE["/cluster/mapping/pci"])
  })
})

describe("/storage", () => {
  it("iaas: the backend addressing is blanked", async () => {
    h.pveFetch.mockImplementation(async (_c: unknown, path: string) => {
      if (path === "/cluster/resources") return [{ type: "storage", storage: "pbs1", node: "pve2", disk: 1, maxdisk: 2 }]
      if (path === "/storage") return [{ storage: "pbs1", type: "pbs", shared: 1, server: "10.0.0.9", datastore: "ds", fingerprint: "AA", content: "backup" }]
      return []
    })
    const load = () => import("@/app/api/v1/connections/[id]/storage/route")
    iaas()
    const [row] = (await get(load, { id: "c1" })).body.data
    expect(row).toMatchObject({ storage: "pbs1", datastore: "ds", server: null, fingerprint: null, path: null })
    provider()
    const [full] = (await get(load, { id: "c1" })).body.data
    expect(full).toMatchObject({ server: "10.0.0.9", fingerprint: "AA" })
  })
})

describe("/rrd and /rrd/batch", () => {
  const rrd = () => import("@/app/api/v1/connections/[id]/rrd/route")

  it("iaas: a node graph is 404, a guest graph is served", async () => {
    iaas()
    expect((await get(rrd, { id: "c1" }, { path: "/nodes/pve2" })).status).toBe(404)
    expect((await get(rrd, { id: "c1" }, { path: "/nodes/pve2/storage/local" })).status).toBe(404)
    const guest = await get(rrd, { id: "c1" }, { path: "/nodes/pve2/qemu/105" })
    expect(guest.status).toBe(200)
    expect(h.pveFetch.mock.calls.map(c => c[1])).toEqual(["/nodes/pve2/qemu/105/rrddata?timeframe=hour&cf=AVERAGE"])
  })

  it("iaas: a batch keeps the guest paths and drops the node paths", async () => {
    iaas()
    const mod = await import("@/app/api/v1/connections/[id]/rrd/batch/route")
    const res = await callRoute(mod.POST, { method: "POST", params: { id: "c1" }, body: { paths: ["/nodes/pve2", "/nodes/pve2/qemu/105"] } })
    const body = await res.json()
    expect(Object.keys(body.data)).toEqual(["/nodes/pve2/qemu/105"])
    expect(h.pveFetch.mock.calls.every(c => String(c[1]).startsWith("/nodes/pve2/qemu/105"))).toBe(true)
  })

  it("provider: node graphs are served", async () => {
    provider()
    expect((await get(rrd, { id: "c1" }, { path: "/nodes/pve2" })).status).toBe(200)
    const mod = await import("@/app/api/v1/connections/[id]/rrd/batch/route")
    const res = await callRoute(mod.POST, { method: "POST", params: { id: "c1" }, body: { paths: ["/nodes/pve2", "/nodes/pve2/qemu/105"] } })
    expect(Object.keys((await res.json()).data).sort()).toEqual(["/nodes/pve2", "/nodes/pve2/qemu/105"])
  })
})

describe("/sdn/zones", () => {
  it("a vDC tenant gets its zones without the VXLAN peers; the provider keeps them", async () => {
    const load = () => import("@/app/api/v1/connections/[id]/sdn/zones/route")
    h.sdnOwnVnets.mockResolvedValue(new Set(["v1"]))
    expect((await get(load, { id: "c1" })).body.data.zones).toEqual([{ zone: "z1", type: "vxlan" }])
    h.sdnOwnVnets.mockResolvedValue(null)
    expect((await get(load, { id: "c1" })).body.data.zones).toEqual(PVE["/cluster/sdn/zones?pending=1"])
  })
})
