/**
 * The orchestrator keeps one change-tracking configuration and one journal for
 * the whole fleet: reading the settings stays open to connection.view (the
 * Changes page shows the retention), but writing them and purging the journal
 * are provider operations, whatever permission the caller holds in its tenant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const { checkPermissionMock, requireProviderAdminMock, orchestratorFetchMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  requireProviderAdminMock: vi.fn(),
  orchestratorFetchMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view", ADMIN_SETTINGS: "admin.settings" },
}))
vi.mock("@/lib/tenant/providerGuard", () => ({ requireProviderAdmin: (...a: any[]) => requireProviderAdminMock(...a) }))
vi.mock("@/lib/orchestrator/client", () => ({ orchestratorFetch: (...a: any[]) => orchestratorFetchMock(...a) }))
vi.mock("@/lib/changes/visibility", () => ({ buildChangeVisibilityCtx: vi.fn(), isChangeVisibleToTenant: vi.fn() }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => "audit-id") }))

const FORBIDDEN = () =>
  new Response(JSON.stringify({ error: "This operation is only available from the provider tenant" }), { status: 403 })

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  requireProviderAdminMock.mockResolvedValue(null)
  orchestratorFetchMock.mockResolvedValue({ ok: true })
})

describe("/api/v1/changes/settings", () => {
  it("GET stays readable with connection.view and does not ask for the provider tenant", async () => {
    orchestratorFetchMock.mockResolvedValue({ retentionDays: 30 })
    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ retentionDays: 30 })
    expect(checkPermissionMock).toHaveBeenCalledWith("connection.view")
    expect(requireProviderAdminMock).not.toHaveBeenCalled()
  })

  it("PUT refuses a customer tenant admin before reaching the orchestrator", async () => {
    requireProviderAdminMock.mockResolvedValue(FORBIDDEN())
    const { PUT } = await import("./route")
    const res = await callRoute(PUT as any, { method: "PUT", body: { retentionDays: 1 } })
    expect(res.status).toBe(403)
    expect(requireProviderAdminMock).toHaveBeenCalledWith("admin.settings")
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it("PUT forwards the body for a provider admin", async () => {
    const { PUT } = await import("./route")
    const res = await callRoute(PUT as any, { method: "PUT", body: { retentionDays: 90 } })
    expect(res.status).toBe(200)
    expect(orchestratorFetchMock).toHaveBeenCalledWith("/changes/settings", { method: "PUT", body: { retentionDays: 90 } })
  })
})

describe("DELETE /api/v1/changes", () => {
  it("purges the fleet journal only from the provider tenant", async () => {
    requireProviderAdminMock.mockResolvedValue(FORBIDDEN())
    const { DELETE } = await import("../route")
    expect((await callRoute(DELETE as any, { method: "DELETE" })).status).toBe(403)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()

    requireProviderAdminMock.mockResolvedValue(null)
    expect((await callRoute(DELETE as any, { method: "DELETE" })).status).toBe(200)
    expect(orchestratorFetchMock).toHaveBeenCalledWith("/changes", { method: "DELETE" })
  })
})
