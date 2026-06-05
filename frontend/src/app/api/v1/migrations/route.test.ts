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

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { runWarmMigration } from "@/lib/migration/warm/warm-pipeline"
import { runMigrationPipeline } from "@/lib/migration/pipeline"

const warm = runWarmMigration as unknown as ReturnType<typeof vi.fn>
const cold = runMigrationPipeline as unknown as ReturnType<typeof vi.fn>

const body = {
  sourceConnectionId: "src", sourceVmId: "vm-1", targetConnectionId: "tgt",
  targetNode: "pve1", targetStorage: "local-lvm", migrationType: "warm",
}

async function runAfters() { for (const cb of h.afterCbs) await cb() }

beforeEach(() => {
  h.afterCbs.length = 0
  warm.mockReset(); cold.mockReset()
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

  it("rejects a malformed downtimeBudgetSec before creating a job", async () => {
    // validated up front (before the connection lookup), so no source mocks needed
    const res = await callRoute(POST, { body: { ...body, downtimeBudgetSec: "abc" } })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toMatch(/downtimeBudgetSec/i)
    expect(h.prisma.migrationJob.create).not.toHaveBeenCalled()
    await runAfters()
    expect(warm).not.toHaveBeenCalled()
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
