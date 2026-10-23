/**
 * POST /api/v1/auth/oidc/test is the companion of the platform-wide OIDC
 * config: provider tenant only, like the config itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const requireProviderAdminMock = vi.fn()

vi.mock("@/lib/rbac", () => ({ PERMISSIONS: { ADMIN_SETTINGS: "admin.settings" } }))
vi.mock("@/lib/tenant/providerGuard", () => ({ requireProviderAdmin: requireProviderAdminMock }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => "audit-id") }))

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderAdminMock.mockResolvedValue(null)
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      issuer: "https://idp.example.com",
      authorization_endpoint: "https://idp.example.com/auth",
      token_endpoint: "https://idp.example.com/token",
    }),
  })
})

describe("POST /api/v1/auth/oidc/test", () => {
  it("refuses a customer tenant admin before any discovery call", async () => {
    requireProviderAdminMock.mockResolvedValue(new Response("forbidden", { status: 403 }))
    const { POST } = await import("./route")
    const res = await callRoute(POST as any, { method: "POST", body: { issuer_url: "https://idp.example.com" } })
    expect(res.status).toBe(403)
    expect(requireProviderAdminMock).toHaveBeenCalledWith("admin.settings")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("runs the discovery for a provider admin", async () => {
    const { POST } = await import("./route")
    const res = await callRoute(POST as any, { method: "POST", body: { issuer_url: "https://idp.example.com/" } })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).success).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe("https://idp.example.com/.well-known/openid-configuration")
  })
})
