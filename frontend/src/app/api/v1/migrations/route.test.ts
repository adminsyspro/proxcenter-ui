import { describe, it, expect, vi, beforeEach } from "vitest"

// Capture the after() callbacks so the test can run the background dispatch.
const h = vi.hoisted(() => ({
  afterCbs: [] as Array<() => Promise<void>>,
  prisma: {
    connection: { findUnique: vi.fn() },
    migrationJob: { create: vi.fn(async () => ({ id: "job-1" })) },
  },
}))

vi.mock("next/server", async (io) => {
  const actual = await io<typeof import("next/server")>()
  return { ...actual, after: (fn: () => Promise<void>) => { h.afterCbs.push(fn) } }
})
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { VM_MIGRATE: "vm.migrate" } }))
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: vi.fn(async () => h.prisma),
  getCurrentTenantId: vi.fn(async () => "default"),
  getTenantPrisma: vi.fn(() => h.prisma),
}))
vi.mock("@/lib/migration/warm/warm-pipeline", () => ({ runWarmMigration: vi.fn() }))
vi.mock("@/lib/migration/pipeline", () => ({ runMigrationPipeline: vi.fn() }))
vi.mock("@/lib/migration/v2v-pipeline", () => ({ runV2vMigrationPipeline: vi.fn() }))
vi.mock("@/lib/migration/xcpng-pipeline", () => ({ runXcpngMigrationPipeline: vi.fn() }))
vi.mock("@/lib/vmware/soap", () => ({ soapLogin: vi.fn(), soapLogout: vi.fn(), soapGetVmConfig: vi.fn(), parseVmConfig: vi.fn() }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "root:pass") }))
vi.mock("@/lib/migration/orphan-sweep", () => ({ resolveInstanceId: vi.fn(() => "inst-1") }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { runWarmMigration } from "@/lib/migration/warm/warm-pipeline"
import { runMigrationPipeline } from "@/lib/migration/pipeline"
import { runV2vMigrationPipeline } from "@/lib/migration/v2v-pipeline"

const warm = runWarmMigration as unknown as ReturnType<typeof vi.fn>
const cold = runMigrationPipeline as unknown as ReturnType<typeof vi.fn>
const v2v = runV2vMigrationPipeline as unknown as ReturnType<typeof vi.fn>

const body = {
  sourceConnectionId: "src", sourceVmId: "vm-1", targetConnectionId: "tgt",
  targetNode: "pve1", targetStorage: "local-lvm", migrationType: "warm",
}

async function runAfters() { for (const cb of h.afterCbs) await cb() }

/** The `data` payload of the first migrationJob.create call of the test. */
function createdJobData(): any {
  return (h.prisma.migrationJob.create as any).mock.calls[0][0].data
}

beforeEach(() => {
  h.afterCbs.length = 0
  warm.mockReset(); cold.mockReset(); v2v.mockReset()
  h.prisma.connection.findUnique.mockReset()
  h.prisma.migrationJob.create.mockReset().mockResolvedValue({ id: "job-1" })
})

describe("POST /api/v1/migrations — warm routing", () => {
  it("dispatches an ESXi-direct warm request to runWarmMigration, never the cold pipeline", async () => {
    h.prisma.connection.findUnique
      .mockResolvedValueOnce({ id: "src", type: "vmware", subType: null, name: "esxi", baseUrl: "https://esxi" })
      .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve" })

    const res = await callRoute(POST, { body: { ...body, downtimeBudgetSec: 600 } })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res))?.data?.jobId).toBe("job-1")

    await runAfters()
    expect(warm).toHaveBeenCalledTimes(1)
    expect(warm.mock.calls[0][0]).toBe("job-1")
    // a valid downtimeBudgetSec is parsed and forwarded to the warm pipeline
    expect(warm.mock.calls[0][1]).toMatchObject({ sourceConnectionId: "src", targetStorage: "local-lvm", downtimeBudgetSec: 600 })
    expect(cold).not.toHaveBeenCalled()
  })

  it("forwards a manual cutoverMode to the warm pipeline", async () => {
    h.prisma.connection.findUnique
      .mockResolvedValueOnce({ id: "src", type: "vmware", subType: null, name: "esxi", baseUrl: "https://esxi" })
      .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve" })

    const res = await callRoute(POST, { body: { ...body, cutoverMode: "manual" } })
    expect(res.status).toBe(200)

    await runAfters()
    expect(warm.mock.calls[0][1]).toMatchObject({ cutoverMode: "manual" })
    // persisted too, so a retry keeps the hold instead of cutting over on its own
    expect(h.prisma.migrationJob.create.mock.calls[0][0].data.config).toMatchObject({ cutoverMode: "manual" })
  })

  it("leaves cutoverMode out of the payload when the caller omits it", async () => {
    h.prisma.connection.findUnique
      .mockResolvedValueOnce({ id: "src", type: "vmware", subType: null, name: "esxi", baseUrl: "https://esxi" })
      .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve" })

    const res = await callRoute(POST, { body })
    expect(res.status).toBe(200)

    await runAfters()
    expect(warm.mock.calls[0][1]).not.toHaveProperty("cutoverMode")
  })

  it("rejects an unknown cutoverMode instead of falling back to auto", async () => {
    // Silently defaulting a typo to "auto" would cut a production VM over in the
    // middle of the day, which is the opposite of what the caller asked for.
    const res = await callRoute(POST, { body: { ...body, cutoverMode: "manuel" } })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toMatch(/cutoverMode/i)
    expect(h.prisma.migrationJob.create).not.toHaveBeenCalled()
    await runAfters()
    expect(warm).not.toHaveBeenCalled()
  })

  it("rejects a malformed downtimeBudgetSec before creating a job", async () => {
    // validated up front (before the connection lookup), so no source mocks needed
    const res = await callRoute(POST, { body: { ...body, downtimeBudgetSec: "abc" } })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toMatch(/downtimeBudgetSec/i)
    expect(h.prisma.migrationJob.create).not.toHaveBeenCalled()
    await runAfters()
    expect(warm).not.toHaveBeenCalled()
  })

  // targetStorage is interpolated into `qm disk import ... ${targetStorage}` on
  // the target node by the pipelines, so a value carrying shell metacharacters
  // must be rejected before any job is created (command injection).
  it.each([
    "local-lvm; rm -rf /",
    "$(id)",
    "store`whoami`",
    "a/b",
    "store with spaces",
  ])("rejects a malformed targetStorage %j before creating a job", async (targetStorage) => {
    const res = await callRoute(POST, { body: { ...body, targetStorage } })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toMatch(/targetStorage/i)
    expect(h.prisma.migrationJob.create).not.toHaveBeenCalled()
    await runAfters()
    expect(warm).not.toHaveBeenCalled()
    expect(cold).not.toHaveBeenCalled()
  })

  // #608 orphan detection: the pipeline runs in this process's after()
  // continuation, so the created row must carry this server's instance id.
  it("persists the owner instance id on the created job", async () => {
    h.prisma.connection.findUnique
      .mockResolvedValueOnce({ id: "src", type: "vmware", subType: null, name: "esxi", baseUrl: "https://esxi" })
      .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve" })

    const res = await callRoute(POST, { body })
    expect(res.status).toBe(200)
    expect(h.prisma.migrationJob.create).toHaveBeenCalledTimes(1)
    expect(h.prisma.migrationJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerInstanceId: "inst-1" }) }),
    )
  })

  // Boolean options must be coerced strictly: raw API callers serialise form
  // state as strings, and `"false"` is truthy. That is how a job whose caller
  // "did not select the option to start VM" still logged `Target VM started`
  // (#443) — the same class of bug the new convertDisksToQcow2 flag would have.
  it('coerces the string "false" to real false for startAfterMigration and convertDisksToQcow2', async () => {
    h.prisma.connection.findUnique
      .mockResolvedValueOnce({ id: "src", type: "vmware", subType: null, name: "esxi", baseUrl: "https://esxi" })
      .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve" })

    const res = await callRoute(POST, { body: { ...body, startAfterMigration: "false", convertDisksToQcow2: "false" } })
    expect(res.status).toBe(200)

    // persisted config (what a retry replays) holds real booleans
    expect(createdJobData().config.startAfterMigration).toBe(false)
    expect(createdJobData().config.convertDisksToQcow2).toBe(false)

    // and the pipeline gate receives the same
    await runAfters()
    expect(warm.mock.calls[0][1]).toMatchObject({ startAfterMigration: false, convertDisksToQcow2: false })
  })

  it("defaults both options to false when omitted, and forwards an explicit true", async () => {
    h.prisma.connection.findUnique
      .mockResolvedValue({ id: "src", type: "vmware", subType: null, name: "esxi", baseUrl: "https://esxi" })
    h.prisma.connection.findUnique
      .mockResolvedValueOnce({ id: "src", type: "vmware", subType: null, name: "esxi", baseUrl: "https://esxi" })
      .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve" })

    await callRoute(POST, { body })
    expect(createdJobData().config).toMatchObject({
      startAfterMigration: false, convertDisksToQcow2: false,
    })

    h.prisma.migrationJob.create.mockClear()
    h.prisma.connection.findUnique
      .mockResolvedValueOnce({ id: "src", type: "vmware", subType: null, name: "esxi", baseUrl: "https://esxi" })
      .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve" })

    await callRoute(POST, { body: { ...body, startAfterMigration: true, convertDisksToQcow2: true } })
    expect(createdJobData().config).toMatchObject({
      startAfterMigration: true, convertDisksToQcow2: true,
    })

    await runAfters()
    const last = warm.mock.calls[warm.mock.calls.length - 1][1]
    expect(last).toMatchObject({ startAfterMigration: true, convertDisksToQcow2: true })
  })

  it("dispatches a vCenter warm request to runWarmMigration, never the cold pipeline", async () => {
    h.prisma.connection.findUnique
      .mockResolvedValueOnce({ id: "src", type: "vmware", subType: "vcenter", name: "vc", baseUrl: "https://vc" })
      .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve" })

    const res = await callRoute(POST, { body })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res))?.data?.jobId).toBe("job-1")

    await runAfters()
    expect(warm).toHaveBeenCalledTimes(1)
    expect(warm.mock.calls[0][0]).toBe("job-1")
    expect(warm.mock.calls[0][1]).toMatchObject({ sourceConnectionId: "src", targetStorage: "local-lvm" })
    expect(cold).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/migrations, virt-v2v root filesystem", () => {
  // v2vRoot ends up in `virt-v2v --root <value>` on the target node, so a value
  // carrying shell metacharacters must never reach the pipeline. Rejected here
  // rather than in the pipeline so the caller sees a 400 instead of a job that
  // fails hours later.
  it.each([
    "/dev/sda2; rm -rf /",
    "$(whoami)",
    "root`id`",
    "/dev/system/root /dev/sda2",
    "/dev/system/root\nreboot",
  ])("rejects a malformed v2vRoot %j before creating a job", async (v2vRoot) => {
    const res = await callRoute(POST, { body: { ...body, migrationType: "cold", v2vRoot } })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toMatch(/v2vRoot/i)
    expect(h.prisma.migrationJob.create).not.toHaveBeenCalled()
    await runAfters()
    expect(v2v).not.toHaveBeenCalled()
    expect(cold).not.toHaveBeenCalled()
  })

  it("forwards a valid v2vRoot to the virt-v2v pipeline", async () => {
    h.prisma.connection.findUnique
      .mockResolvedValueOnce({ id: "src", type: "vmware", subType: "vcenter", name: "vc", baseUrl: "https://vc" })
      .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve" })

    const res = await callRoute(POST, {
      body: { ...body, migrationType: "cold", v2vRoot: " /dev/system/root " },
    })
    expect(res.status).toBe(200)

    await runAfters()
    expect(v2v).toHaveBeenCalledTimes(1)
    // trimmed on the way through, so the pipeline never has to guess
    expect(v2v.mock.calls[0][1]).toMatchObject({ v2vRoot: "/dev/system/root" })
  })

  it("leaves v2vRoot out of the payload when the caller omits it", async () => {
    // Absence matters: an empty string would be passed to virt-v2v as --root ''
    h.prisma.connection.findUnique
      .mockResolvedValueOnce({ id: "src", type: "vmware", subType: "vcenter", name: "vc", baseUrl: "https://vc" })
      .mockResolvedValueOnce({ id: "tgt", type: "pve", name: "pve" })

    const res = await callRoute(POST, { body: { ...body, migrationType: "cold", v2vRoot: "" } })
    expect(res.status).toBe(200)

    await runAfters()
    expect(v2v).toHaveBeenCalledTimes(1)
    expect(v2v.mock.calls[0][1]).not.toHaveProperty("v2vRoot")
  })
})
