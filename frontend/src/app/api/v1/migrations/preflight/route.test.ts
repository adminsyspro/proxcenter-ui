import { describe, it, expect, vi, beforeEach } from "vitest"

// RBAC allows; the route gates on VM_MIGRATE.
vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn(async () => null),
  PERMISSIONS: { VM_MIGRATE: "vm.migrate" },
}))
// v2v-preflight is the default action; stub all its exports the route imports.
vi.mock("@/lib/migration/v2v-preflight", () => ({
  runV2vPreflight: vi.fn(async () => ({ ssh: true, errors: [] })),
  installV2vPackages: vi.fn(async () => ({ success: true })),
  startVirtioWinDownload: vi.fn(async () => ({ success: true })),
  checkVirtioWinProgress: vi.fn(async () => ({ done: true })),
}))
// The warm go/no-go helper — the new action under test.
vi.mock("@/lib/migration/warm/vddk-preflight", () => ({
  runWarmNodePreflight: vi.fn(async () => ({ ok: true, missing: [] })),
}))
vi.mock("@/lib/migration/warm/xcpng-node-preflight", () => ({
  runXcpngWarmNodePreflight: vi.fn(async () => ({ ok: true, missing: [] })),
}))
vi.mock("@/lib/migration/warm/target-space", () => ({
  checkTargetStorageSpace: vi.fn(),
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: { connection: { findUnique: vi.fn(async () => ({ type: "vmware" })) } },
}))
// Only the boolean flag is consumed here; mocking also keeps the module's
// ssh2/prisma import chain out of this test.
vi.mock("@/lib/migration/warm/vddk-provision", () => ({
  isVddkPackageTokenConfigured: vi.fn(() => false),
}))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { runWarmNodePreflight } from "@/lib/migration/warm/vddk-preflight"
import { isVddkPackageTokenConfigured } from "@/lib/migration/warm/vddk-provision"
import { runV2vPreflight } from "@/lib/migration/v2v-preflight"
import { runXcpngWarmNodePreflight } from "@/lib/migration/warm/xcpng-node-preflight"
import { checkTargetStorageSpace, type TargetSpaceResult } from "@/lib/migration/warm/target-space"
import { prisma } from "@/lib/db/prisma"

const mockWarm = runWarmNodePreflight as unknown as ReturnType<typeof vi.fn>
const mockV2v = runV2vPreflight as unknown as ReturnType<typeof vi.fn>
const mockTokenConfigured = isVddkPackageTokenConfigured as unknown as ReturnType<typeof vi.fn>
const mockSpace = vi.mocked(checkTargetStorageSpace)
const mockSource = prisma.connection.findUnique as unknown as ReturnType<typeof vi.fn>
const spaceVerdict: TargetSpaceResult = {
  storage: "ZFS-Pool", type: "zfspool", availableBytes: 12 * 1024 ** 3,
  requiredBytes: 16 * 1024 ** 3, sufficient: false,
}
const warmBody = {
  action: "warm-check", sourceConnectionId: "src", targetConnectionId: "c1", targetNode: "pve1",
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSource.mockResolvedValue({ type: "vmware" })
  mockSpace.mockResolvedValue(spaceVerdict)
})

describe("POST /api/v1/migrations/preflight — warm-check action", () => {
  it("returns target space alongside the VDDK runtime verdict", async () => {
    const res = await callRoute(POST, {
      body: { ...warmBody, targetStorage: "ZFS-Pool", requiredDiskBytes: spaceVerdict.requiredBytes },
    })

    expect(res.status).toBe(200)
    expect(mockSource).toHaveBeenCalledWith({ where: { id: "src" }, select: { type: true } })
    expect(mockSpace).toHaveBeenCalledExactlyOnceWith("c1", "pve1", "ZFS-Pool", spaceVerdict.requiredBytes)
    expect(await res.json()).toEqual({ ok: true, missing: [], kind: "vddk", vddkTokenConfigured: false, space: spaceVerdict })
    expect(runXcpngWarmNodePreflight).not.toHaveBeenCalled()
  })

  it("omits space and does not check storage when targetStorage is absent", async () => {
    const res = await callRoute(POST, { body: { ...warmBody, requiredDiskBytes: spaceVerdict.requiredBytes } })

    expect(res.status).toBe(200)
    expect(mockSpace).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.kind).toBe("vddk")
    expect(json.space).toBeUndefined()
    expect(json).not.toHaveProperty("space")
  })

  it.each([-1, "abc"])("clamps requiredDiskBytes %j to zero", async (requiredDiskBytes) => {
    const res = await callRoute(POST, { body: { ...warmBody, targetStorage: "ZFS-Pool", requiredDiskBytes } })

    expect(res.status).toBe(200)
    expect(mockSpace).toHaveBeenCalledExactlyOnceWith("c1", "pve1", "ZFS-Pool", 0)
    expect((await res.json()).space).toEqual(spaceVerdict)
  })

  it("returns target space alongside the NBD runtime verdict for an XCP-ng source", async () => {
    mockSource.mockResolvedValueOnce({ type: "xcpng" })
    const res = await callRoute(POST, {
      body: { ...warmBody, targetStorage: "ZFS-Pool", requiredDiskBytes: spaceVerdict.requiredBytes },
    })

    expect(res.status).toBe(200)
    expect(mockSpace).toHaveBeenCalledExactlyOnceWith("c1", "pve1", "ZFS-Pool", spaceVerdict.requiredBytes)
    expect(runXcpngWarmNodePreflight).toHaveBeenCalledExactlyOnceWith("c1", "pve1")
    expect(mockWarm).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ ok: true, missing: [], kind: "nbd", vddkTokenConfigured: false, space: spaceVerdict })
  })

  it("dispatches warm-check to runWarmNodePreflight and returns its go/no-go verbatim", async () => {
    mockWarm.mockResolvedValueOnce({ ok: false, missing: ["vddk-plugin", "vddk-lib"], error: "node not prepared" })
    const res = await callRoute(POST, { body: { action: "warm-check", targetConnectionId: "c1", targetNode: "pve1" } })
    expect(res.status).toBe(200)
    expect(mockWarm).toHaveBeenCalledWith("c1", "pve1", undefined)
    const json = await readJson<{ ok: boolean; missing: string[] }>(res)
    expect(json?.ok).toBe(false)
    expect(json?.missing).toContain("vddk-plugin")
    // Must NOT fall through to the v2v preflight.
    expect(mockV2v).not.toHaveBeenCalled()
  })

  it("threads vddkLibdir through so the check uses the migration's libdir", async () => {
    mockWarm.mockResolvedValueOnce({ ok: true, missing: [] })
    const res = await callRoute(POST, {
      body: { action: "warm-check", targetConnectionId: "c1", targetNode: "pve1", vddkLibdir: "/opt/vddk" },
    })
    expect(res.status).toBe(200)
    expect(mockWarm).toHaveBeenCalledWith("c1", "pve1", "/opt/vddk")
    const json = await readJson<{ ok: boolean }>(res)
    expect(json?.ok).toBe(true)
  })

  it("400s when targetConnectionId/targetNode are missing", async () => {
    const res = await callRoute(POST, { body: { action: "warm-check" } })
    expect(res.status).toBe(400)
    expect(mockWarm).not.toHaveBeenCalled()
  })

  it("reports whether the Enterprise VDDK package token is configured — boolean only, never the token", async () => {
    mockTokenConfigured.mockReturnValueOnce(true)
    mockWarm.mockResolvedValueOnce({ ok: false, missing: ["vddk-lib"], error: "node not prepared" })
    const res = await callRoute(POST, { body: { action: "warm-check", targetConnectionId: "c1", targetNode: "pve1" } })
    const json = await readJson<{ ok: boolean; vddkTokenConfigured?: boolean }>(res)
    expect(json?.vddkTokenConfigured).toBe(true)
    // The flag is route-layer only: the preflight helper itself is untouched.
    expect(mockWarm).toHaveBeenCalledWith("c1", "pve1", undefined)
  })

  it("hides the automated-setup offer when no token is configured", async () => {
    mockTokenConfigured.mockReturnValueOnce(false)
    const res = await callRoute(POST, { body: { action: "warm-check", targetConnectionId: "c1", targetNode: "pve1" } })
    const json = await readJson<{ vddkTokenConfigured?: boolean }>(res)
    expect(json?.vddkTokenConfigured).toBe(false)
  })

  it("leaves the default v2v preflight path intact", async () => {
    const res = await callRoute(POST, { body: { targetConnectionId: "c1", targetNode: "pve1", requiredDiskBytes: 100 } })
    expect(res.status).toBe(200)
    expect(mockV2v).toHaveBeenCalled()
    expect(mockWarm).not.toHaveBeenCalled()
  })
})
