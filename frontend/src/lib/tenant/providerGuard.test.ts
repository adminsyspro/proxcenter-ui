import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireProviderTenantMock, checkPermissionMock } = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

vi.mock("./index", () => ({ requireProviderTenant: (...a: any[]) => requireProviderTenantMock(...a) }))
vi.mock("@/lib/rbac", () => ({ checkPermission: (...a: any[]) => checkPermissionMock(...a) }))

import { requireProviderAdmin } from "./providerGuard"

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
})

describe("requireProviderAdmin", () => {
  it("passes when the caller is in the provider tenant and holds the permission", async () => {
    expect(await requireProviderAdmin("admin.settings")).toBeNull()
    expect(checkPermissionMock).toHaveBeenCalledWith("admin.settings")
  })

  it("returns the tenant refusal first, without loading any RBAC grant", async () => {
    const refusal = new Response(null, { status: 403 })
    requireProviderTenantMock.mockResolvedValue(refusal)
    expect(await requireProviderAdmin("admin.settings")).toBe(refusal)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it("returns the permission refusal of a provider-tenant caller lacking the right", async () => {
    const denied = new Response(null, { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)
    expect(await requireProviderAdmin("admin.users")).toBe(denied)
    expect(checkPermissionMock).toHaveBeenCalledWith("admin.users")
  })
})
