// PVE load of GET /api/v1/vms (UA52): the guest list is shared for 15 s, the config fields come from the guest config
// cache, only missing configs are read, through the connection's pool, concurrent callers share the reads, a slow
// Proxmox trips the connection, ?refresh=1 is held to once per 30 s, and the payload keeps its shape.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../__tests__/setup/route-test"

const h = vi.hoisted(() => ({
  pveFetch: vi.fn<(conn: any, path: string, init?: any, opts?: any) => Promise<any>>(),
  findMany: vi.fn(),
}))

vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: async () => ({ kind: "provider" }),
}))
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({ connection: { findMany: h.findMany } }),
  getCurrentTenantId: async () => "default",
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { connection: { findMany: h.findMany } } }))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: async (id: string) => ({ id, baseUrl: "https://pve.test", apiToken: "t" }),
}))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: h.pveFetch }))
vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  getRBACContext: vi.fn().mockResolvedValue(null),
  filterVmsByPermission: (_uid: any, list: any[]) => Promise.resolve(list),
  PERMISSIONS: { VM_VIEW: "vm.view" },
}))
vi.mock("@/lib/api-tokens/routeGuard", () => ({ withPublicApiGuard: (_id: string, handler: any) => handler }))
vi.mock("@/utils/format", () => ({ formatBytes: (n: number) => `${n}B`, formatUptime: (s: number) => `${s}s` }))

import { __resetGuestIpIndexForTests, getGuestIpInflight } from "@/lib/cache/guestIpCache"
import { resetConnectionPools } from "@/lib/inventory/connectionPool"
import { DISK_TOTAL_TTL_MS, invalidateGuestDiskTotal, rememberGuestConfig, resetGuestDiskTotals } from "@/lib/inventory/guestDiskTotals"
import { resetGuestIpProbeTimes } from "@/lib/inventory/guestIpIndex"
import { LISTING_TTL_MS, REFRESH_MIN_MS, TRIP_COOLDOWN_MS, resetVmsListing } from "@/lib/inventory/vmsListing"

import { GET } from "./route"

type Guest = { vmid: number; node: string; type: "qemu" | "lxc"; status?: string }

const T0 = 1_800_000_000_000

let guests: Guest[] = []
let nodes: Array<{ node: string; status: string }> = []
let configDelay = 0
let configImpl: (path: string) => Promise<any> = async () => ({
  cores: 2, memory: 2048, net0: "virtio=BC:24:11:00:00:01,bridge=vmbr0,firewall=1,tag=20",
  ipconfig0: "ip=10.0.0.10/24", scsi0: "local:vm-1-disk-0,size=8G", description: "web",
})
let inFlight = 0
let peak = 0
let peakNode = 0
const perNode = new Map<string, number>()

const configCalls = () => h.pveFetch.mock.calls.filter(([, p]) => String(p).endsWith("/config")).length
const listCalls = () => h.pveFetch.mock.calls.filter(([, p]) => p === "/cluster/resources?type=vm" || p === "/nodes").length

const get = (searchParams?: Record<string, string>) => callRoute(GET, { method: "GET", searchParams: { connId: "c1", ...searchParams } })
const vmsOf = async (res: Response) => (await res.json()).data

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(T0)
  resetVmsListing()
  resetGuestDiskTotals()
  resetConnectionPools()
  __resetGuestIpIndexForTests()
  resetGuestIpProbeTimes()
  h.findMany.mockResolvedValue([{ id: "c1", name: "PVE", tenantId: "default" }])
  guests = [
    { vmid: 100, node: "n1", type: "qemu" },
    { vmid: 101, node: "n1", type: "lxc" },
    { vmid: 102, node: "n2", type: "qemu" },
  ]
  nodes = [{ node: "n1", status: "online" }, { node: "n2", status: "online" }]
  configDelay = 0
  inFlight = 0
  peak = 0
  peakNode = 0
  perNode.clear()
  configImpl = async () => ({
    cores: 2, memory: 2048, net0: "virtio=BC:24:11:00:00:01,bridge=vmbr0,firewall=1,tag=20",
    ipconfig0: "ip=10.0.0.10/24", scsi0: "local:vm-1-disk-0,size=8G", description: "web",
  })
  h.pveFetch.mockImplementation(async (_conn, path) => {
    if (path === "/cluster/resources?type=vm") {
      return guests.map(g => ({ ...g, status: g.status ?? "running", name: `g${g.vmid}`, maxmem: 1, maxdisk: 1, tags: "zone-web" }))
    }
    if (path === "/nodes") return nodes
    if (String(path).endsWith("/config")) {
      const node = String(path).split("/")[2]
      inFlight++
      perNode.set(node, (perNode.get(node) ?? 0) + 1)
      peak = Math.max(peak, inFlight)
      peakNode = Math.max(peakNode, perNode.get(node)!)
      try {
        if (configDelay > 0) await new Promise(resolve => setTimeout(resolve, configDelay))
        return await configImpl(String(path))
      } finally {
        inFlight--
        perNode.set(node, perNode.get(node)! - 1)
      }
    }
    return []
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("GET /api/v1/vms PVE load (UA52)", () => {
  it("cold: 2 list calls and one config per guest; warm: 0 Proxmox call, same rows", async () => {
    const cold = await vmsOf(await get())
    expect(listCalls()).toBe(2)
    expect(configCalls()).toBe(3)
    expect(cold.partial).toBe(false)
    expect(cold.cached_at).toBe(new Date(T0).toISOString())

    h.pveFetch.mockClear()
    vi.setSystemTime(T0 + 5_000)
    const warm = await vmsOf(await get())

    expect(h.pveFetch).not.toHaveBeenCalled()
    expect(warm.vms).toEqual(cold.vms)
    expect(warm.cached_at).toBe(new Date(T0).toISOString())
  })

  // `lock` and `netvmid` are undefined here, so JSON leaves them out, as before UA52.
  it("keeps the payload shape: every field of a row, config fields included", async () => {
    const data = await vmsOf(await get())
    const qemu = data.vms.find((v: any) => v.vmid === "100")

    expect(Object.keys(data).sort()).toEqual(["cached_at", "ipIndexWarming", "partial", "stats", "vms"])
    expect(Object.keys(qemu).sort()).toEqual([
      "agentEnabled", "bios", "configIps", "connId", "connectionName", "cores", "cpu", "cpuType", "createdAt",
      "description", "diskGb", "diskTotal", "host", "id", "ip", "ips", "machine", "macs", "maxdisk", "maxmem",
      "memoryMb", "name", "node", "onboot", "ostype", "pool", "ram", "ramMax", "ramMaxFormatted", "ramUsed",
      "ramUsedFormatted", "scope", "scsihw", "sockets", "staleIps", "status", "tags", "template", "type", "uptime",
      "uptimeSeconds", "vmid",
    ].sort())
    expect(qemu).toMatchObject({ cores: 2, memoryMb: 2048, ips: ["10.0.0.10"], macs: ["BC:24:11:00:00:01"], description: "web", tags: ["zone-web"] })
  })

  it("serves the configs the inventory already read: list calls only", async () => {
    for (const g of guests) rememberGuestConfig("c1", g.type, g.vmid, { cores: 1, scsi0: "local:x,size=1G", rootfs: "local:y,size=1G" })

    const data = await vmsOf(await get())

    expect(configCalls()).toBe(0)
    expect(listCalls()).toBe(2)
    expect(data.vms.find((v: any) => v.vmid === "100").cores).toBe(1)
  })

  it("reads only the configs it lacks", async () => {
    await get()
    invalidateGuestDiskTotal("c1", "qemu", 102)
    h.pveFetch.mockClear()
    vi.setSystemTime(T0 + LISTING_TTL_MS)

    await get()

    expect(configCalls()).toBe(1)
    expect(h.pveFetch.mock.calls.some(([, p]) => String(p).includes("/qemu/102/config"))).toBe(true)
  })

  it("reads a config again once past the inventory TTL", async () => {
    await get()
    h.pveFetch.mockClear()
    vi.setSystemTime(T0 + DISK_TOTAL_TTL_MS)

    await get()

    expect(configCalls()).toBe(3)
  })

  it("shares one list read and one config read per guest between concurrent callers", async () => {
    configDelay = 10

    const answers = await Promise.all([get(), get(), get()])

    expect(answers.every(r => r.status === 200)).toBe(true)
    expect(listCalls()).toBe(2)
    expect(configCalls()).toBe(3)
    for (const r of answers) expect((await vmsOf(r)).vms).toHaveLength(3)
  })

  it("keeps at most 4 config reads in flight on the connection, 2 per node", async () => {
    configDelay = 5
    guests = Array.from({ length: 40 }, (_, i) => ({ vmid: 200 + i, node: `n${i % 3}`, type: "qemu" as const }))
    nodes = ["n0", "n1", "n2"].map(node => ({ node, status: "online" }))

    await get()

    expect(configCalls()).toBe(40)
    expect(peak).toBeLessThanOrEqual(4)
    expect(peakNode).toBeLessThanOrEqual(2)
  })

  it("asks no guest of an offline node, and says partial", async () => {
    nodes = [{ node: "n1", status: "online" }, { node: "n2", status: "offline" }]

    const data = await vmsOf(await get())

    expect(h.pveFetch.mock.calls.some(([, p]) => String(p).includes("/nodes/n2/"))).toBe(false)
    expect(data.partial).toBe(true)
    expect(data.vms.find((v: any) => v.vmid === "102")).toMatchObject({ cpuType: null, configIps: [], diskGb: 0 })
  })

  it("trips on a config read that timed out: no further read on the connection for a minute", async () => {
    guests = Array.from({ length: 8 }, (_, i) => ({ vmid: 300 + i, node: "n1", type: "qemu" as const }))
    configImpl = async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })
    }

    const first = await vmsOf(await get())
    // The 2 node slots were taken before the first timeout came back; nothing started after it.
    expect(configCalls()).toBeLessThanOrEqual(2)
    expect(first.partial).toBe(true)

    h.pveFetch.mockClear()
    vi.setSystemTime(T0 + LISTING_TTL_MS)
    await get()
    expect(configCalls()).toBe(0)

    vi.setSystemTime(T0 + TRIP_COOLDOWN_MS)
    configImpl = async () => ({ cores: 1, scsi0: "local:x,size=1G" })
    await get()
    expect(configCalls()).toBe(8)
  })

  it("does not ask again for a minute a config whose read failed", async () => {
    configImpl = async (path) => {
      if (path.includes("/100/")) throw new Error("403 Permission check failed")
      return { cores: 1, scsi0: "local:x,size=1G", rootfs: "local:y,size=1G" }
    }
    await get()
    h.pveFetch.mockClear()
    vi.setSystemTime(T0 + LISTING_TTL_MS)

    const data = await vmsOf(await get())

    expect(configCalls()).toBe(0)
    expect(data.partial).toBe(true)
  })

  it("?refresh=1 reads the list and every config again, at most once per 30 s per connection", async () => {
    await get()
    h.pveFetch.mockClear()

    vi.setSystemTime(T0 + 1_000)
    await get({ refresh: "1" })
    expect(listCalls()).toBe(2)
    expect(configCalls()).toBe(3)

    h.pveFetch.mockClear()
    vi.setSystemTime(T0 + 2_000)
    await get({ refresh: "1" })
    expect(h.pveFetch).not.toHaveBeenCalled()

    vi.setSystemTime(T0 + 1_000 + REFRESH_MIN_MS)
    await get({ refresh: "1" })
    expect(configCalls()).toBe(3)
  })

  it("shows new tags at the next read past 15 s (an apply by the micro-segmentation engine)", async () => {
    await get()
    h.pveFetch.mockImplementationOnce(async () => guests.map(g => ({ ...g, status: "running", maxdisk: 1, tags: g.vmid === 100 ? "zone-db" : "zone-web" })))
    vi.setSystemTime(T0 + LISTING_TTL_MS)

    const data = await vmsOf(await get())

    expect(data.vms.find((v: any) => v.vmid === "100").tags).toEqual(["zone-db"])
    expect(configCalls()).toBe(3)
  })

  it("never probes a guest agent for a container nor without the flag", async () => {
    await get()

    expect(h.pveFetch.mock.calls.some(([, p]) => String(p).includes("/agent/") || String(p).includes("/interfaces"))).toBe(false)
  })

  // The load table of the report: Proxmox calls per call of the route, by kind.
  it.each([36, 200])("load table for %i guests: cold, warm, past 15 s, past the TTL, include=agent", async (n) => {
    guests = Array.from({ length: n }, (_, i) => ({ vmid: 1000 + i, node: `n${i % 3}`, type: i % 2 === 0 ? "qemu" as const : "lxc" as const }))
    nodes = ["n0", "n1", "n2"].map(node => ({ node, status: "online" }))
    configImpl = async () => ({ agent: "1", cores: 1, scsi0: "local:x,size=1G", rootfs: "local:y,size=1G" })
    const count = async () => {
      await getGuestIpInflight("c1")
      const paths = h.pveFetch.mock.calls.map(([, p]) => String(p))
      h.pveFetch.mockClear()
      return {
        list: paths.filter(p => p === "/cluster/resources?type=vm" || p === "/nodes").length,
        config: paths.filter(p => p.endsWith("/config")).length,
        agent: paths.filter(p => p.includes("/agent/")).length,
      }
    }
    const qemu = Math.ceil(n / 2)

    await get()
    const cold = await count()
    vi.setSystemTime(T0 + 5_000)
    await get()
    const warm = await count()
    vi.setSystemTime(T0 + LISTING_TTL_MS)
    await get()
    const later = await count()
    vi.setSystemTime(T0 + DISK_TOTAL_TTL_MS)
    await get()
    const pastTtl = await count()
    vi.setSystemTime(T0 + DISK_TOTAL_TTL_MS + 5_000)
    await get({ include: "agent" })
    const agent = await count()

    console.log(`[load ${n}] cold ${JSON.stringify(cold)} warm ${JSON.stringify(warm)} +15s ${JSON.stringify(later)} +15min ${JSON.stringify(pastTtl)} include=agent ${JSON.stringify(agent)}`)
    // The background address index probes the running qemu guests with the agent flag, once (UA52: never a container).
    expect(cold).toEqual({ list: 2, config: n, agent: qemu })
    expect(warm).toEqual({ list: 0, config: 0, agent: 0 })
    expect(later).toEqual({ list: 2, config: 0, agent: 0 })
    expect(pastTtl).toEqual({ list: 2, config: n, agent: qemu })
    // Export only: /agent/info + /agent/get-osinfo per running qemu guest with the flag.
    expect(agent).toEqual({ list: 0, config: 0, agent: 2 * qemu })
  })
})
