/**
 * Task 15 (security): GET /api/v1/orchestrator/sflow proxied the Go
 * orchestrator's fleet-wide sFlow aggregator with NO permission check and
 * NO tenant scoping at all. Traced row shapes (internal/sflow/models.go):
 * only TopTalker and the status.agents entries carry a connection_id --
 * TopPair, TopPort, TopEndpoint, IPPair and every timeseries/* point carry
 * none. Since most sub-resources have no linkage to filter on, and a
 * partial filter would still let a tenant pivot through the unfiltered
 * ones to see every other tenant's VM traffic, the fix gates the whole
 * route to the provider tenant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, requireProviderTenantMock, orchestratorFetchMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  requireProviderTenantMock: vi.fn(),
  orchestratorFetchMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))

vi.mock("@/lib/tenant", () => ({
  requireProviderTenant: (...a: any[]) => requireProviderTenantMock(...a),
}))

vi.mock("@/lib/orchestrator", () => ({
  orchestratorFetch: (...a: any[]) => orchestratorFetchMock(...a),
}))

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  orchestratorFetchMock.mockResolvedValue({ ok: true })
})

describe("GET /api/v1/orchestrator/sflow — provider-only gate", () => {
  it("rejects a non-provider tenant before ever reaching the orchestrator", async () => {
    requireProviderTenantMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "This operation is only available from the provider tenant" }), { status: 403 })
    )

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { searchParams: { endpoint: "top-talkers" } })
    expect(res.status).toBe(403)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it("allows the provider tenant through", async () => {
    requireProviderTenantMock.mockResolvedValue(null)

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { searchParams: { endpoint: "top-talkers" } })
    expect(res.status).toBe(200)
    expect(orchestratorFetchMock).toHaveBeenCalledWith(expect.stringContaining("/sflow/top-talkers"))
  })
})
