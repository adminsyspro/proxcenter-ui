/**
 * Tests for GET/PUT /api/v1/auth/oidc, focused on the SSO-only login flags
 * (show_local_login / force_sso_redirect) and the anti-lockout coercion.
 * Route deps are mocked; the handler is imported after the mocks are wired.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson, deniedPermissionResponse } from "@/__tests__/setup/route-test"

const checkPermissionMock = vi.fn()
const findUniqueMock = vi.fn()
const upsertMock = vi.fn()
const encryptSecretMock = vi.fn()
const normalizeGroupRoleMappingMock = vi.fn()
const auditMock = vi.fn()

vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_SETTINGS: "admin.settings" },
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    oidcConfig: { findUnique: findUniqueMock, upsert: upsertMock },
  },
}))

vi.mock("@/lib/crypto/secret", () => ({ encryptSecret: encryptSecretMock }))

vi.mock("@/lib/auth/groupMapping", () => ({
  normalizeGroupRoleMapping: normalizeGroupRoleMappingMock,
}))

vi.mock("@/lib/audit", () => ({ audit: auditMock }))

async function importRoute() {
  return await import("../route")
}

beforeEach(() => {
  vi.clearAllMocks()
  // Allowed by default; individual tests override to test the denied path.
  checkPermissionMock.mockResolvedValue(null)
  normalizeGroupRoleMappingMock.mockReturnValue({})
  upsertMock.mockResolvedValue({})
  auditMock.mockResolvedValue(undefined)
})

// ─── GET ────────────────────────────────────────────────────────────────────

describe("GET /api/v1/auth/oidc", () => {
  it("returns the denied response when permission is missing", async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    const { GET } = await importRoute()
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(403)
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it("returns safe defaults (local visible, no redirect) when no config row exists", async () => {
    findUniqueMock.mockResolvedValue(null)
    const { GET } = await importRoute()
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.enabled).toBe(false)
    expect(body.data.show_local_login).toBe(true)
    expect(body.data.force_sso_redirect).toBe(false)
    expect(body.data.hasClientSecret).toBe(false)
    expect(body.data.group_role_mapping).toBe("{}")
  })

  it("returns the persisted flags and serializes the group mapping when a row exists", async () => {
    findUniqueMock.mockResolvedValue({
      enabled: true,
      providerName: "Okta",
      issuerUrl: "https://idp.example.com",
      clientId: "cid",
      scopes: "openid",
      authorizationUrl: null,
      tokenUrl: null,
      userinfoUrl: null,
      claimEmail: "email",
      claimName: "name",
      claimGroups: "groups",
      autoProvision: true,
      defaultRole: "viewer",
      showLocalLogin: false,
      forceSsoRedirect: true,
      groupRoleMapping: { admin: "role_admin" },
      clientSecretEnc: "enc:secret",
    })
    const { GET } = await importRoute()
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.show_local_login).toBe(false)
    expect(body.data.force_sso_redirect).toBe(true)
    expect(body.data.hasClientSecret).toBe(true)
    expect(body.data.group_role_mapping).toBe(JSON.stringify({ admin: "role_admin" }))
  })

  it("returns 500 when the lookup throws", async () => {
    findUniqueMock.mockRejectedValue(new Error("db down"))
    const { GET } = await importRoute()
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(500)
  })
})

// ─── PUT ────────────────────────────────────────────────────────────────────

describe("PUT /api/v1/auth/oidc", () => {
  it("returns the denied response when permission is missing", async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    const { PUT } = await importRoute()
    const res = await callRoute(PUT as any, { method: "PUT", body: { enabled: true } })
    expect(res.status).toBe(403)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("rejects an enabled config with no issuer URL", async () => {
    const { PUT } = await importRoute()
    const res = await callRoute(PUT as any, { method: "PUT", body: { enabled: true } })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toBe("Issuer URL is required")
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("rejects an enabled config with an issuer but no client ID", async () => {
    const { PUT } = await importRoute()
    const res = await callRoute(PUT as any, {
      method: "PUT",
      body: { enabled: true, issuer_url: "https://idp.example.com" },
    })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toBe("Client ID is required")
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("persists the SSO-only flags when OIDC is enabled", async () => {
    const { PUT } = await importRoute()
    const res = await callRoute(PUT as any, {
      method: "PUT",
      body: {
        enabled: true,
        issuer_url: "https://idp.example.com",
        client_id: "cid",
        show_local_login: false,
        force_sso_redirect: true,
      },
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const arg = upsertMock.mock.calls[0][0]
    expect(arg.update.showLocalLogin).toBe(false)
    expect(arg.update.forceSsoRedirect).toBe(true)
    expect(arg.create.showLocalLogin).toBe(false)
    expect(arg.create.forceSsoRedirect).toBe(true)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: "oidc_config", action: "update" }),
    )
  })

  it("coerces the flags to safe values when OIDC is disabled (anti-lockout)", async () => {
    const { PUT } = await importRoute()
    const res = await callRoute(PUT as any, {
      method: "PUT",
      // Stale flags carried by the form while disabling OIDC must not stick.
      body: { enabled: false, show_local_login: false, force_sso_redirect: true },
    })
    expect(res.status).toBe(200)
    const arg = upsertMock.mock.calls[0][0]
    expect(arg.update.showLocalLogin).toBe(true)
    expect(arg.update.forceSsoRedirect).toBe(false)
    expect(arg.update.clientSecretEnc).toBeUndefined()
    expect(encryptSecretMock).not.toHaveBeenCalled()
  })

  it("encrypts and stores the client secret only when a fresh value is submitted", async () => {
    encryptSecretMock.mockReturnValue("enc:newsecret")
    const { PUT } = await importRoute()
    const res = await callRoute(PUT as any, {
      method: "PUT",
      body: {
        enabled: true,
        issuer_url: "https://idp.example.com",
        client_id: "cid",
        client_secret: "newsecret",
      },
    })
    expect(res.status).toBe(200)
    expect(encryptSecretMock).toHaveBeenCalledWith("newsecret")
    const arg = upsertMock.mock.calls[0][0]
    expect(arg.update.clientSecretEnc).toBe("enc:newsecret")
    expect(arg.create.clientSecretEnc).toBe("enc:newsecret")
  })

  it("returns 500 when the upsert throws", async () => {
    upsertMock.mockRejectedValue(new Error("db down"))
    const { PUT } = await importRoute()
    const res = await callRoute(PUT as any, {
      method: "PUT",
      body: { enabled: true, issuer_url: "https://idp.example.com", client_id: "cid" },
    })
    expect(res.status).toBe(500)
  })
})
