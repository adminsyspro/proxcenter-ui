import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  prisma: { migrationJob: { findUnique: vi.fn() } },
}))

vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { VM_MIGRATE: "vm.migrate" } }))
vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock("@/lib/migration/v2v-pipeline", () => ({ requestV2vRootChoice: vi.fn(() => true) }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { requestV2vRootChoice } from "@/lib/migration/v2v-pipeline"
import { checkPermission } from "@/lib/rbac"

const signal = requestV2vRootChoice as unknown as ReturnType<typeof vi.fn>

const parkedJob = (overrides: Record<string, unknown> = {}) => ({
  id: "j1",
  status: "converting_disks",
  currentStep: "awaiting_root_choice",
  config: {
    v2vRootCandidates: [
      { device: "/dev/sda1", description: "Ubuntu 22.04" },
      { device: "/dev/sda2" },
    ],
  },
  ...overrides,
})

beforeEach(() => {
  h.prisma.migrationJob.findUnique.mockReset()
  signal.mockReset()
  signal.mockReturnValue(true)
})

describe("POST /api/v1/migrations/[id]/root-choice", () => {
  it("signals the chosen root and reports it back", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue(parkedJob())
    const res = await callRoute(POST, { params: { id: "j1" }, body: { root: " /dev/sda1 " } })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { status: "root_choice_requested", root: "/dev/sda1" } })
    expect(signal).toHaveBeenCalledWith("j1", "/dev/sda1")
  })

  it("400s when the root is missing from the body", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue(parkedJob())
    const res = await callRoute(POST, { params: { id: "j1" }, body: {} })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toMatch(/root/i)
    expect(signal).not.toHaveBeenCalled()
  })

  it("400s when the root is not a string", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue(parkedJob())
    const res = await callRoute(POST, { params: { id: "j1" }, body: { root: 42 } })
    expect(res.status).toBe(400)
    expect(signal).not.toHaveBeenCalled()
  })

  it("400s when the root is not one of the recorded candidates", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue(parkedJob())
    const res = await callRoute(POST, { params: { id: "j1" }, body: { root: "/dev/sdb1" } })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toMatch(/candidates/i)
    expect(signal).not.toHaveBeenCalled()
  })

  it.each([
    "/dev/sda1; reboot",
    "$(id)",
    "/dev/sda1 && rm -rf /",
    "`touch /pwned`",
  ])("refuses shell metacharacters via the allowlist: %s", async (payload) => {
    // The value ends up on a shell command line on the Proxmox node; none of
    // these match a recorded candidate, so they must die here, not downstream.
    h.prisma.migrationJob.findUnique.mockResolvedValue(parkedJob())
    const res = await callRoute(POST, { params: { id: "j1" }, body: { root: payload } })
    expect(res.status).toBe(400)
    expect(signal).not.toHaveBeenCalled()
  })

  it("400s when the pipeline recorded no candidates", async () => {
    // A parked step with no list means the allowlist is empty: nothing passes.
    h.prisma.migrationJob.findUnique.mockResolvedValue(parkedJob({ config: {} }))
    const res = await callRoute(POST, { params: { id: "j1" }, body: { root: "/dev/sda1" } })
    expect(res.status).toBe(400)
    expect(signal).not.toHaveBeenCalled()
  })

  it("400s when the job is not waiting for a root choice", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue(parkedJob({ currentStep: "converting_disks" }))
    const res = await callRoute(POST, { params: { id: "j1" }, body: { root: "/dev/sda1" } })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toMatch(/not waiting/i)
    expect(signal).not.toHaveBeenCalled()
  })

  it("400s when the registry rejects the value on its own sanitization", async () => {
    signal.mockReturnValue(false)
    h.prisma.migrationJob.findUnique.mockResolvedValue(parkedJob())
    const res = await callRoute(POST, { params: { id: "j1" }, body: { root: "/dev/sda1" } })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toMatch(/root/i)
  })

  it("404s when the job is missing", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue(null)
    const res = await callRoute(POST, { params: { id: "nope" }, body: { root: "/dev/sda1" } })
    expect(res.status).toBe(404)
    expect(signal).not.toHaveBeenCalled()
  })

  it("propagates a permission denial", async () => {
    ;(checkPermission as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("forbidden", { status: 403 }) as any
    )
    const res = await callRoute(POST, { params: { id: "j1" }, body: { root: "/dev/sda1" } })
    expect(res.status).toBe(403)
    expect(h.prisma.migrationJob.findUnique).not.toHaveBeenCalled()
    expect(signal).not.toHaveBeenCalled()
  })
})
