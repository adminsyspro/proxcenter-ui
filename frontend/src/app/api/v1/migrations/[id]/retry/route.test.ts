import { describe, it, expect, vi, beforeEach } from "vitest"

// Capture the after() callbacks so the test can run the background dispatch.
const h = vi.hoisted(() => ({
  afterCbs: [] as Array<() => Promise<void>>,
  infra: { kind: "provider" } as any,
  prisma: {
    migrationJob: { findFirst: vi.fn(), create: vi.fn(async () => ({ id: "job-2" })) },
    connection: { findUnique: vi.fn() },
  },
}))

vi.mock("next/server", async (io) => {
  const actual = await io<typeof import("next/server")>()
  return { ...actual, after: (fn: () => Promise<void>) => { h.afterCbs.push(fn) } }
})
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/rbac", () => ({ getCurrentRbacInfraScope: vi.fn(async () => null), checkPermission: vi.fn(async () => null), PERMISSIONS: { VM_MIGRATE: "vm.migrate" } }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: vi.fn(async () => h.infra),
}))
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: vi.fn(async () => h.prisma),
  getCurrentTenantId: vi.fn(async () => "default"),
}))
vi.mock("@/lib/migration/pipeline", () => ({ runMigrationPipeline: vi.fn() }))
vi.mock("@/lib/migration/v2v-pipeline", () => ({ runV2vMigrationPipeline: vi.fn() }))
vi.mock("@/lib/migration/xcpng-pipeline", () => ({ runXcpngMigrationPipeline: vi.fn() }))
vi.mock("@/lib/migration/warm/warm-pipeline", () => ({ runWarmMigration: vi.fn() }))
vi.mock("@/lib/migration/warm/xcpng-warm-pipeline", () => ({ runXcpngWarmMigration: vi.fn() }))
vi.mock("@/lib/migration/orphan-sweep", () => ({ resolveInstanceId: vi.fn(() => "inst-1") }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { runMigrationPipeline } from "@/lib/migration/pipeline"
import { runV2vMigrationPipeline } from "@/lib/migration/v2v-pipeline"
import { runXcpngMigrationPipeline } from "@/lib/migration/xcpng-pipeline"
import { runWarmMigration } from "@/lib/migration/warm/warm-pipeline"
import { runXcpngWarmMigration } from "@/lib/migration/warm/xcpng-warm-pipeline"

const cold = runMigrationPipeline as unknown as ReturnType<typeof vi.fn>
const v2v = runV2vMigrationPipeline as unknown as ReturnType<typeof vi.fn>
const xcpngCold = runXcpngMigrationPipeline as unknown as ReturnType<typeof vi.fn>
const warm = runWarmMigration as unknown as ReturnType<typeof vi.fn>
const xcpngWarm = runXcpngWarmMigration as unknown as ReturnType<typeof vi.fn>

const failedJob = {
  id: "job-1", status: "failed",
  sourceConnectionId: "src", sourceVmId: "vm-1", sourceVmName: null, sourceHost: null,
  targetConnectionId: "tgt", targetNode: "pve1", targetStorage: "local-lvm",
  config: { sourceConnectionId: "src", sourceVmId: "vm-1", migrationType: "cold" },
}

async function runAfters() { for (const cb of h.afterCbs) await cb() }

beforeEach(() => {
  h.afterCbs.length = 0
  cold.mockReset()
  v2v.mockReset()
  xcpngCold.mockReset()
  warm.mockReset()
  xcpngWarm.mockReset()
  h.prisma.migrationJob.findFirst.mockReset()
  h.prisma.migrationJob.create.mockReset().mockResolvedValue({ id: "job-2" })
  h.prisma.connection.findUnique.mockReset()
})

describe("POST /api/v1/migrations/[id]/retry", () => {
  it("creates the retry job tagged with this server's instance id and dispatches it", async () => {
    h.prisma.migrationJob.findFirst.mockResolvedValueOnce(failedJob)

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res))?.data?.jobId).toBe("job-2")
    // #608 orphan detection: the retried pipeline runs in this process too
    expect(h.prisma.migrationJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerInstanceId: "inst-1", status: "pending" }) }),
    )

    await runAfters()
    expect(cold).toHaveBeenCalledTimes(1)
    expect(cold.mock.calls[0][0]).toBe("job-2")
  })

  it("refuses to retry a job that is still running", async () => {
    h.prisma.migrationJob.findFirst.mockResolvedValueOnce({ ...failedJob, status: "transferring" })

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
    expect(res.status).toBe(400)
    expect(h.prisma.migrationJob.create).not.toHaveBeenCalled()
  })

  it("re-dispatches an XCP-ng warm job to the XCP-ng warm pipeline", async () => {
    const job = { ...failedJob, config: { ...failedJob.config, migrationType: "warm" } }
    h.prisma.migrationJob.findFirst.mockResolvedValueOnce(job)
    h.prisma.connection.findUnique.mockResolvedValueOnce({ type: "xcpng" })

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { jobId: "job-2", status: "pending" } })
    expect(h.prisma.connection.findUnique).toHaveBeenCalledWith({
      where: { id: "src" },
      select: { type: true, subType: true },
    })

    await runAfters()
    expect(xcpngWarm).toHaveBeenCalledWith("job-2", expect.objectContaining({ sourceConnectionId: "src", sourceVmId: "vm-1" }), "default")
    expect(warm).not.toHaveBeenCalled()
    expect(cold).not.toHaveBeenCalled()
  })

  it("re-dispatches a VMware warm job to the VMware warm pipeline", async () => {
    const job = { ...failedJob, config: { ...failedJob.config, migrationType: "warm" } }
    h.prisma.migrationJob.findFirst.mockResolvedValueOnce(job)
    h.prisma.connection.findUnique.mockResolvedValueOnce({ type: "vmware" })

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { jobId: "job-2", status: "pending" } })

    await runAfters()
    expect(warm).toHaveBeenCalledWith("job-2", expect.objectContaining({ sourceConnectionId: "src", sourceVmId: "vm-1" }), "default")
    expect(xcpngWarm).not.toHaveBeenCalled()
    expect(cold).not.toHaveBeenCalled()
  })

  it("falls back to config.sourceType when an XCP-ng warm source connection was deleted", async () => {
    const job = {
      ...failedJob,
      config: { ...failedJob.config, migrationType: "warm", sourceType: "xcpng" },
    }
    h.prisma.migrationJob.findFirst.mockResolvedValueOnce(job)
    h.prisma.connection.findUnique.mockResolvedValueOnce(null)

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { jobId: "job-2", status: "pending" } })

    await runAfters()
    expect(xcpngWarm).toHaveBeenCalledWith("job-2", expect.objectContaining({ sourceConnectionId: "src", sourceVmId: "vm-1" }), "default")
    expect(warm).not.toHaveBeenCalled()
    expect(cold).not.toHaveBeenCalled()
  })

  it("re-dispatches a failed Hyper-V job to the v2v pipeline", async () => {
    const job = {
      ...failedJob,
      config: {
        sourceType: "hyperv",
        migrationType: "cold",
        diskPaths: ["/mnt/hyperv/a/b.vhdx"],
        sourceVmName: "2025-test",
      },
    }
    h.prisma.migrationJob.findFirst.mockResolvedValueOnce(job)
    h.prisma.connection.findUnique.mockResolvedValueOnce({ type: "hyperv", subType: null })

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
    expect(res.status).toBe(200)
    await runAfters()

    expect(v2v).toHaveBeenCalledOnce()
    expect(v2v).toHaveBeenCalledWith("job-2", expect.objectContaining({
      sourceType: "hyperv",
      diskPaths: ["/mnt/hyperv/a/b.vhdx"],
      sourceVmName: "2025-test",
      migrationType: "cold",
    }), "default")
    expect(cold).not.toHaveBeenCalled()
  })

  it("uses the live connection type for a legacy Hyper-V job", async () => {
    const job = { ...failedJob, config: { ...failedJob.config, migrationType: "cold" } }
    h.prisma.migrationJob.findFirst.mockResolvedValueOnce(job)
    h.prisma.connection.findUnique.mockResolvedValueOnce({ type: "hyperv", subType: null })

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
    expect(res.status).toBe(200)
    await runAfters()

    expect(v2v).toHaveBeenCalledOnce()
    expect(v2v.mock.calls[0][0]).toBe("job-2")
    // The rebuilt config must carry the live connection's type too, not the
    // "vmware" default: the v2v pipeline rejects an unknown source type.
    expect(v2v.mock.calls[0][1]).toMatchObject({ sourceType: "hyperv", migrationType: "cold" })
    expect(cold).not.toHaveBeenCalled()
  })

  it("re-dispatches an XCP-ng cold job to the XCP-ng pipeline", async () => {
    const job = { ...failedJob, config: { sourceType: "xcpng", migrationType: "cold" } }
    h.prisma.migrationJob.findFirst.mockResolvedValueOnce(job)
    h.prisma.connection.findUnique.mockResolvedValueOnce({ type: "xcpng", subType: null })

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
    expect(res.status).toBe(200)
    await runAfters()

    expect(xcpngCold).toHaveBeenCalledWith("job-2", expect.objectContaining({ migrationType: "cold" }), "default")
    expect(cold).not.toHaveBeenCalled()
  })

  it("preserves live mode when retrying a vCenter job through v2v", async () => {
    const job = { ...failedJob, config: { sourceType: "vcenter", migrationType: "live" } }
    h.prisma.migrationJob.findFirst.mockResolvedValueOnce(job)
    h.prisma.connection.findUnique.mockResolvedValueOnce({ type: "vmware", subType: "vcenter" })

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
    expect(res.status).toBe(200)
    await runAfters()

    expect(v2v).toHaveBeenCalledWith("job-2", expect.objectContaining({
      sourceType: "vcenter",
      migrationType: "live",
    }), "default")
    expect(cold).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/migrations/[id]/retry, the retrying user is checked again (#317)", () => {
  it("refuses a vDC tenant, as the creation route does, and creates nothing", async () => {
    const { getCurrentTenantId } = await import("@/lib/tenant")
    vi.mocked(getCurrentTenantId).mockResolvedValueOnce("tenant-1")
    h.infra = { kind: "iaas", vdcScope: {} }
    try {
      h.prisma.migrationJob.findFirst.mockResolvedValueOnce(failedJob)
      const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
      expect(res.status).toBe(404)
      expect(h.prisma.migrationJob.create).not.toHaveBeenCalled()
    } finally {
      h.infra = { kind: "provider" }
    }
  })

  it("refuses to replay a saved per-NIC VLAN for a user without the VLAN permission", async () => {
    const { getCurrentTenantId } = await import("@/lib/tenant")
    const { checkPermission } = await import("@/lib/rbac")
    vi.mocked(getCurrentTenantId).mockResolvedValueOnce("tenant-1")
    h.infra = { kind: "msp", connectionIds: new Set(["src", "tgt"]) }
    vi.mocked(checkPermission)
      .mockImplementationOnce(async () => null) // vm.migrate
      .mockImplementationOnce(async () => Response.json({ error: "denied" }, { status: 403 }) as any) // VLAN on the saved NIC
    try {
      h.prisma.migrationJob.findFirst.mockResolvedValueOnce({
        ...failedJob,
        config: { ...failedJob.config, networkBridge: "vmbr0", nics: [{ index: 1, bridge: "vmbr1", vlanTag: 42 }] },
      })
      const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
      expect(res.status).toBe(403)
      expect(h.prisma.migrationJob.create).not.toHaveBeenCalled()
    } finally {
      h.infra = { kind: "provider" }
    }
  })
})
