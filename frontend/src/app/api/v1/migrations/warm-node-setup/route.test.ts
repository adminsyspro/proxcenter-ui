import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

// RBAC allows by default; the route gates on VM_MIGRATE like its preflight sibling.
vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn(async () => null),
  PERMISSIONS: { VM_MIGRATE: "vm.migrate" },
}))
// The VDDK package is an Enterprise deliverable: the route additionally gates
// on the vmware_migration feature.
vi.mock("@/lib/auth/requireEnterprise", () => ({
  requireFeature: vi.fn(async () => null),
}))
// The provisioning engine — the route only orchestrates auth/validation around it.
vi.mock("@/lib/migration/warm/vddk-provision", () => ({
  provisionWarmNode: vi.fn(async () => ({ ok: true, missing: [] })),
}))
// POST is wrapped by withAudit() (#1105); the real audit() would reach Prisma
// and the syslog forwarder.
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => "audit-id") }))

import { POST } from "./route"
import { audit } from "@/lib/audit"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { checkPermission } from "@/lib/rbac"
import { requireFeature } from "@/lib/auth/requireEnterprise"
import { provisionWarmNode } from "@/lib/migration/warm/vddk-provision"

const mockPermission = checkPermission as unknown as ReturnType<typeof vi.fn>
const mockFeature = requireFeature as unknown as ReturnType<typeof vi.fn>
const mockProvision = provisionWarmNode as unknown as ReturnType<typeof vi.fn>
const mockAudit = audit as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockPermission.mockResolvedValue(null)
  mockFeature.mockResolvedValue(null)
  mockProvision.mockResolvedValue({ ok: true, missing: [] })
})

describe("POST /api/v1/migrations/warm-node-setup", () => {
  it("provisions the node and returns the post-provision preflight verdict", async () => {
    mockProvision.mockResolvedValueOnce({ ok: true, missing: [] })
    const res = await callRoute(POST, { body: { targetConnectionId: "c1", targetNode: "pve1" } })
    expect(res.status).toBe(200)
    expect(mockProvision).toHaveBeenCalledWith("c1", "pve1", undefined)
    const json = await readJson<{ ok: boolean; missing: string[] }>(res)
    expect(json?.ok).toBe(true)
    expect(json?.missing).toEqual([])
    // The safety-net row: the route itself never audits.
    expect(mockAudit).toHaveBeenCalledTimes(1)
    expect(mockAudit.mock.calls[0][0]).toMatchObject({
      category: "migration", action: "create", resourceType: "warm_node_setup", status: "success",
      details: expect.objectContaining({ method: "POST", httpStatus: 200 }),
    })
  })

  it("threads vddkLibdir through so provisioning matches a custom-libdir migration", async () => {
    const res = await callRoute(POST, {
      body: { targetConnectionId: "c1", targetNode: "pve1", vddkLibdir: "/opt/vddk" },
    })
    expect(res.status).toBe(200)
    expect(mockProvision).toHaveBeenCalledWith("c1", "pve1", "/opt/vddk")
  })

  it("denies without VM_MIGRATE and never touches the node", async () => {
    mockPermission.mockResolvedValueOnce(NextResponse.json({ error: "Forbidden" }, { status: 403 }))
    const res = await callRoute(POST, { body: { targetConnectionId: "c1", targetNode: "pve1" } })
    expect(res.status).toBe(403)
    expect(mockProvision).not.toHaveBeenCalled()
    expect(mockAudit).toHaveBeenCalledTimes(1)
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ category: "migration", action: "create", status: "failure", errorMessage: "Forbidden", details: expect.objectContaining({ httpStatus: 403 }) })
  })

  it("denies when the vmware_migration feature is not licensed", async () => {
    mockFeature.mockResolvedValueOnce(NextResponse.json({ error: "Feature not licensed" }, { status: 403 }))
    const res = await callRoute(POST, { body: { targetConnectionId: "c1", targetNode: "pve1" } })
    expect(res.status).toBe(403)
    expect(mockFeature).toHaveBeenCalledWith("vmware_migration")
    expect(mockProvision).not.toHaveBeenCalled()
  })

  it("400s when targetConnectionId/targetNode are missing", async () => {
    const res = await callRoute(POST, { body: { targetNode: "pve1" } })
    expect(res.status).toBe(400)
    expect(mockProvision).not.toHaveBeenCalled()
  })

  it("400s on a non-JSON body", async () => {
    const res = await callRoute(POST, { body: "not json", method: "POST" })
    expect(res.status).toBe(400)
    expect(mockProvision).not.toHaveBeenCalled()
  })

  it("surfaces provisioning failures as a 500 with the actionable message", async () => {
    mockProvision.mockRejectedValueOnce(new Error("GHCR refused the configured VDDK package token (HTTP 401)"))
    const res = await callRoute(POST, { body: { targetConnectionId: "c1", targetNode: "pve1" } })
    expect(res.status).toBe(500)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain("GHCR refused")
  })
})
