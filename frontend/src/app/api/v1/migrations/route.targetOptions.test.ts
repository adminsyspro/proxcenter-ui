import { describe, it, expect, vi, beforeEach } from "vitest"

// Capture the after() callbacks so the test can run the background dispatch.
const h = vi.hoisted(() => ({
  macCheck: vi.fn(),
  afterCbs: [] as Array<() => Promise<void>>,
  licensed: true,
  infra: { kind: "provider" } as any,
  prisma: {
    connection: { findUnique: vi.fn() },
    migrationJob: { create: vi.fn(async () => ({ id: "job-1" })), findFirst: vi.fn(async () => null), findMany: vi.fn(async () => [] as any[]) },
  },
}))

vi.mock("next/server", async (io) => {
  const actual = await io<typeof import("next/server")>()
  return { ...actual, after: (fn: () => Promise<void>) => { h.afterCbs.push(fn) } }
})
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/auth/requireEnterprise", () => ({ hasServerFeature: vi.fn(async () => h.licensed) }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: vi.fn(async () => h.infra),
}))
vi.mock("@/lib/rbac", () => ({ getCurrentRbacInfraScope: vi.fn(async () => null), checkPermission: vi.fn(async () => null), PERMISSIONS: { VM_MIGRATE: "vm.migrate", CONNECTION_MANAGE: "connection.manage" } }))
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: vi.fn(async () => h.prisma),
  getCurrentTenantId: vi.fn(async () => "default"),
  getTenantPrisma: vi.fn(() => h.prisma),
}))
vi.mock("@/lib/migration/warm/warm-pipeline", () => ({ runWarmMigration: vi.fn() }))
vi.mock("@/lib/migration/warm/xcpng-warm-pipeline", () => ({ runXcpngWarmMigration: vi.fn() }))
vi.mock("@/lib/migration/pipeline", () => ({ runMigrationPipeline: vi.fn() }))
vi.mock("@/lib/migration/v2v-pipeline", () => ({ runV2vMigrationPipeline: vi.fn() }))
vi.mock("@/lib/migration/xcpng-pipeline", () => ({ runXcpngMigrationPipeline: vi.fn() }))
vi.mock("@/lib/vmware/soap", () => ({ soapLogin: vi.fn(), soapLogout: vi.fn(), soapGetVmConfig: vi.fn(), parseVmConfig: vi.fn() }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "root:pass") }))
vi.mock("@/lib/migration/orphan-sweep", () => ({ resolveInstanceId: vi.fn(() => "inst-1") }))
vi.mock("@/lib/tasks/sharedTask", () => ({ TERMINAL_STATUSES: ["completed", "failed", "cancelled"] }))

vi.mock("@/lib/migration/mac-conflicts", () => ({ findTargetMacConflicts: (...a: any[]) => h.macCheck(...a) }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { runWarmMigration } from "@/lib/migration/warm/warm-pipeline"
import { runXcpngMigrationPipeline } from "@/lib/migration/xcpng-pipeline"

/**
 * ui#1330 (MAC), ui#1331 (disk profile) and ui#1333 (network table) on the
 * create route: validated, refused where no engine applies them, persisted
 * and forwarded to the engine.
 */
const warm = runWarmMigration as unknown as ReturnType<typeof vi.fn>
const xcpng = runXcpngMigrationPipeline as unknown as ReturnType<typeof vi.fn>

const body = {
  sourceConnectionId: "src", sourceVmId: "vm-1", targetConnectionId: "tgt",
  targetNode: "pve1", targetStorage: "local-lvm", migrationType: "warm",
}
const esxi = () => h.prisma.connection.findUnique
  .mockResolvedValueOnce({ id: "src", type: "vmware", subType: null, name: "esxi", baseUrl: "https://esxi" })
  .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve", baseUrl: "https://pve:8006" })

async function runAfters() { await Promise.all(h.afterCbs.map(cb => cb())) }
const createdConfig = (): any => (h.prisma.migrationJob.create as any).mock.calls[0][0].data.config

beforeEach(() => {
  h.afterCbs.length = 0
  warm.mockReset(); xcpng.mockReset()
  h.macCheck.mockReset().mockResolvedValue({ ok: true, conflicts: [] })
  h.prisma.connection.findUnique.mockReset()
  h.prisma.migrationJob.create.mockReset().mockResolvedValue({ id: "job-1" })
  h.prisma.migrationJob.findFirst.mockReset().mockResolvedValue(null)
})

describe("POST /api/v1/migrations target options (ui#1330, #1331, #1333)", () => {
  it("persists the MAC policy, disk profile and network table and hands them to the engine", async () => {
    esxi()
    const res = await callRoute(POST, { body: { ...body, macPolicy: "regenerate", diskOptions: { ssd: true }, networkMap: [{ source: "DMZ", bridge: "vmbr2", vlanTag: 30 }] } })
    expect(res.status).toBe(200)
    expect(createdConfig()).toMatchObject({ macPolicy: "regenerate", diskOptions: { ssd: true }, networkMap: [{ source: "DMZ", bridge: "vmbr2", vlanTag: 30 }] })
    await runAfters()
    expect(warm.mock.calls[0][1]).toMatchObject({ macPolicy: "regenerate", diskOptions: { ssd: true }, networkMap: [{ source: "DMZ", bridge: "vmbr2", vlanTag: 30 }] })
    expect(h.macCheck).not.toHaveBeenCalled()
  })

  it("checks a custom MAC against the target cluster and refuses one already in use", async () => {
    esxi()
    h.macCheck.mockResolvedValue({ ok: true, conflicts: [{ mac: "BC:24:11:00:00:01", vmid: 104 }] })
    const res = await callRoute(POST, { body: { ...body, nics: [{ index: 0, bridge: "vmbr0", macMode: "custom", mac: "bc:24:11:00:00:01" }] } })
    expect(res.status).toBe(409)
    expect((await readJson<any>(res))?.error).toBe("MAC address already used on the target cluster: BC:24:11:00:00:01 (VM 104)")
    expect(h.macCheck).toHaveBeenCalledWith(h.prisma, { connectionId: "tgt", node: "pve1", baseUrl: "https://pve:8006" }, ["BC:24:11:00:00:01"])
    expect(h.prisma.migrationJob.create).not.toHaveBeenCalled()
  })

  it("refuses to start when the custom MACs cannot be checked", async () => {
    esxi()
    h.macCheck.mockResolvedValue({ ok: false, error: "node unreachable" })
    const res = await callRoute(POST, { body: { ...body, nics: [{ index: 0, bridge: "vmbr0", macMode: "custom", mac: "BC:24:11:00:00:01" }] } })
    expect(res.status).toBe(502)
    expect((await readJson<any>(res))?.error).toContain("node unreachable")
  })

  it("accepts a free custom MAC and persists it on its NIC", async () => {
    esxi()
    const res = await callRoute(POST, { body: { ...body, nics: [{ index: 0, bridge: "vmbr0", macMode: "custom", mac: "BC:24:11:00:00:01" }] } })
    expect(res.status).toBe(200)
    expect(createdConfig().nics).toEqual([{ index: 0, bridge: "vmbr0", macMode: "custom", mac: "BC:24:11:00:00:01" }])
  })

  it("refuses the same custom MAC on two adapters before any SSH", async () => {
    const res = await callRoute(POST, { body: { ...body, nics: [
      { index: 0, bridge: "vmbr0", macMode: "custom", mac: "BC:24:11:00:00:01" },
      { index: 1, bridge: "vmbr0", macMode: "custom", mac: "bc:24:11:00:00:01" },
    ] } })
    expect(res.status).toBe(400)
    expect(h.macCheck).not.toHaveBeenCalled()
  })

  it.each([
    [{ macPolicy: "random" }, "macPolicy"],
    [{ diskOptions: { discard: "on" } }, "diskOptions.discard"],
    [{ networkMap: [{ source: "A", bridge: "bad bridge" }] }, "networkMap"],
  ])("refuses a malformed %j", async (extra, message) => {
    const res = await callRoute(POST, { body: { ...body, ...extra } })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toContain(message)
  })

  it("refuses a network table on a source whose networks it cannot name", async () => {
    h.prisma.connection.findUnique
      .mockResolvedValueOnce({ id: "src", type: "xcpng", subType: "xo", name: "xo", baseUrl: "https://xo" })
      .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve", baseUrl: "https://pve:8006" })
    const res = await callRoute(POST, { body: { ...body, migrationType: "cold", networkMap: [{ source: "A", bridge: "vmbr0" }] } })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toContain("only supported for VMware sources")
  })

  it("applies the MAC policy and disk profile on an XCP-ng source", async () => {
    h.prisma.connection.findUnique
      .mockResolvedValueOnce({ id: "src", type: "xcpng", subType: "xo", name: "xo", baseUrl: "https://xo" })
      .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve", baseUrl: "https://pve:8006" })
    const res = await callRoute(POST, { body: { ...body, migrationType: "cold", macPolicy: "regenerate", diskOptions: { discard: false } } })
    expect(res.status).toBe(200)
    await runAfters()
    expect(xcpng.mock.calls[0][1]).toMatchObject({ macPolicy: "regenerate", diskOptions: { discard: false } })
  })
})
