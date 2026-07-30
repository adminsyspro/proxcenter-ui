import os from "node:os"

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { prismaTest, truncate } from "@/__tests__/setup/prisma-test"
import {
  FOREIGN_ORPHAN_MAX_AGE_MS,
  ORPHANED_JOB_ERROR,
  resolveInstanceId,
  sweepOrphanedMigrationJobs,
} from "./orphan-sweep"

// The sweep module transitively imports @/lib/tenant via sharedTask; keep the
// auth surface out of the node test environment.
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))

const NOW = new Date("2026-07-29T12:00:00.000Z")
const ME = "node-a"

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000)

async function seedJob(over: Record<string, unknown> = {}) {
  return prismaTest.migrationJob.create({
    data: {
      sourceConnectionId: "src",
      sourceVmId: "vm-1",
      targetConnectionId: "tgt",
      targetNode: "pve1",
      targetStorage: "local-lvm",
      status: "transferring",
      currentStep: "transferring",
      updatedAt: NOW,
      ...over,
    },
  })
}

const sweep = () => sweepOrphanedMigrationJobs({ prisma: prismaTest, instanceId: ME, now: NOW })
const reload = (id: string) => prismaTest.migrationJob.findUniqueOrThrow({ where: { id } })

beforeEach(async () => {
  await truncate(["migration_jobs"])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await prismaTest.$disconnect()
})

describe("sweepOrphanedMigrationJobs", () => {
  it("fails non-terminal jobs owned by this instance regardless of age", async () => {
    const fresh = await seedJob({ ownerInstanceId: ME, updatedAt: NOW })
    const stale = await seedJob({ ownerInstanceId: ME, status: "pending", updatedAt: hoursAgo(48) })

    const res = await sweep()
    expect(res).toEqual({ owned: 2, foreign: 0, total: 2 })

    for (const id of [fresh.id, stale.id]) {
      const job = await reload(id)
      expect(job.status).toBe("failed")
      // currentStep must follow status: the task bar and the detail dialog both
      // render the step, so leaving "transferring" shows a failed job as live.
      expect(job.currentStep).toBe("failed")
      expect(job.error).toBe(ORPHANED_JOB_ERROR)
      expect(job.error).toMatch(/stopped/)
      expect(job.completedAt?.getTime()).toBe(NOW.getTime())
    }
  })

  it("fails an ownerless legacy job only once it has been silent for more than 12h", async () => {
    const old = await seedJob({ updatedAt: hoursAgo(13) })
    const atCutoff = await seedJob({ updatedAt: new Date(NOW.getTime() - FOREIGN_ORPHAN_MAX_AGE_MS) })
    const recent = await seedJob({ updatedAt: hoursAgo(1) })

    const res = await sweep()
    expect(res).toEqual({ owned: 0, foreign: 1, total: 1 })

    expect((await reload(old.id)).status).toBe("failed")
    // strict `<` cutoff and a live-looking row: both stay untouched
    for (const id of [atCutoff.id, recent.id]) {
      const job = await reload(id)
      expect(job.status).toBe("transferring")
      expect(job.error).toBeNull()
      expect(job.completedAt).toBeNull()
    }
  })

  // The regression that would have kept spahit's job immortal: os.hostname() is
  // the container id on a single-node install, so an image upgrade renames this
  // instance and its own leftover rows come back as foreign.
  it("fails a job left by a renamed instance once it is past the age bound", async () => {
    const oldIncarnation = await seedJob({ ownerInstanceId: "previous-container-id", updatedAt: hoursAgo(18) })

    const res = await sweep()
    expect(res).toEqual({ owned: 0, foreign: 1, total: 1 })

    const job = await reload(oldIncarnation.id)
    expect(job.status).toBe("failed")
    expect(job.currentStep).toBe("failed")
    expect(job.error).toBe(ORPHANED_JOB_ERROR)
  })

  it("never touches a recent job owned by another instance, which may be a live peer", async () => {
    const peer = await seedJob({ ownerInstanceId: "node-b", updatedAt: hoursAgo(2) })

    const res = await sweep()
    expect(res).toEqual({ owned: 0, foreign: 0, total: 0 })

    const job = await reload(peer.id)
    expect(job.status).toBe("transferring")
    expect(job.error).toBeNull()
    expect(job.completedAt).toBeNull()
  })

  it("never touches terminal jobs, even our own or ancient ownerless ones", async () => {
    const done = new Date("2026-07-01T00:00:00.000Z")
    const completed = await seedJob({ ownerInstanceId: ME, status: "completed", completedAt: done })
    const cancelled = await seedJob({ status: "cancelled", updatedAt: hoursAgo(100), completedAt: done })
    const failed = await seedJob({ ownerInstanceId: ME, status: "failed", error: "boom", completedAt: done })

    const res = await sweep()
    expect(res).toEqual({ owned: 0, foreign: 0, total: 0 })

    expect((await reload(completed.id)).status).toBe("completed")
    expect((await reload(cancelled.id)).status).toBe("cancelled")
    const failedJob = await reload(failed.id)
    expect(failedJob.error).toBe("boom")
    expect(failedJob.completedAt?.getTime()).toBe(done.getTime())
  })
})

describe("resolveInstanceId", () => {
  it("prefers PROXCENTER_INSTANCE_ID", () => {
    vi.stubEnv("PROXCENTER_INSTANCE_ID", "pve-node-1")
    expect(resolveInstanceId()).toBe("pve-node-1")
  })

  it("falls back to os.hostname() when the override is unset or empty", () => {
    vi.stubEnv("PROXCENTER_INSTANCE_ID", "")
    vi.spyOn(os, "hostname").mockReturnValue("bare-metal-1")
    expect(resolveInstanceId()).toBe("bare-metal-1")
  })

  // The Dockerfile sets HOSTNAME=0.0.0.0 for Next's standalone server, so every
  // instance would claim the same identity and sweep its peers' live jobs.
  it("ignores HOSTNAME, which the image pins to 0.0.0.0 for every instance", () => {
    vi.stubEnv("PROXCENTER_INSTANCE_ID", "")
    vi.stubEnv("HOSTNAME", "0.0.0.0")
    vi.spyOn(os, "hostname").mockReturnValue("real-host")
    expect(resolveInstanceId()).toBe("real-host")
  })
})
