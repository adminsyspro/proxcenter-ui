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
  runWarmNodePreflight: vi.fn(async () => ({ ok: false, missing: ["vddk-plugin"], error: "node not prepared" })),
}))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { runWarmNodePreflight } from "@/lib/migration/warm/vddk-preflight"
import { runV2vPreflight } from "@/lib/migration/v2v-preflight"

const mockWarm = runWarmNodePreflight as unknown as ReturnType<typeof vi.fn>
const mockV2v = runV2vPreflight as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe("POST /api/v1/migrations/preflight — warm-check action", () => {
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

  it("leaves the default v2v preflight path intact", async () => {
    const res = await callRoute(POST, { body: { targetConnectionId: "c1", targetNode: "pve1", requiredDiskBytes: 100 } })
    expect(res.status).toBe(200)
    expect(mockV2v).toHaveBeenCalled()
    expect(mockWarm).not.toHaveBeenCalled()
  })
})
