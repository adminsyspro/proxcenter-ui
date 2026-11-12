/**
 * Per-tenant OIDC connection loader (issue #1289): NextAuth provider ids, which
 * connections are live, and the slug lookup of the tenant login page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { findUniqueMock, findManyMock, tenantFindUniqueMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findManyMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    oidcConfig: { findUnique: findUniqueMock, findMany: findManyMock },
    tenant: { findUnique: tenantFindUniqueMock },
  },
}))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: (v: string) => `plain:${v}` }))

import {
  connectionIdFromProvider,
  getActiveTenantConnectionBySlug,
  getOidcConnection,
  isTenantConnection,
  listActiveOidcConnections,
  PROVIDER_CONNECTION_ID,
  providerIdFor,
} from "./oidcConnections"

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantId: id,
    enabled: true,
    providerName: `IdP ${id}`,
    issuerUrl: `https://idp.example.test/${id}`,
    clientId: "pxc",
    clientSecretEnc: "enc",
    scopes: "openid profile email",
    claimEmail: "email",
    claimName: "name",
    claimGroups: "groups",
    autoProvision: true,
    defaultRole: "tenant_viewer",
    groupRoleMapping: [],
    allowedDomains: ["Acme.example"],
    tenant: { enabled: true },
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe("NextAuth provider ids", () => {
  it("keeps the historical id for the provider connection", () => {
    expect(PROVIDER_CONNECTION_ID).toBe("default")
    expect(providerIdFor("default")).toBe("oidc")
    expect(connectionIdFromProvider("oidc")).toBe("default")
  })

  it("gives a tenant connection its own id, hence its own callback", () => {
    expect(providerIdFor("t-acme")).toBe("oidc-t-acme")
    expect(connectionIdFromProvider("oidc-t-acme")).toBe("t-acme")
  })

  it("maps nothing else to a connection", () => {
    expect(connectionIdFromProvider("credentials")).toBeNull()
    expect(connectionIdFromProvider("ldap")).toBeNull()
    expect(connectionIdFromProvider("oidc-")).toBeNull()
    expect(connectionIdFromProvider(undefined)).toBeNull()
  })

  it("tells a tenant connection from the provider one", () => {
    expect(isTenantConnection({ id: "default" })).toBe(false)
    expect(isTenantConnection({ id: "t-acme" })).toBe(true)
  })
})

describe("getOidcConnection", () => {
  it("reads the row of that id, secret decrypted, domains normalised", async () => {
    findUniqueMock.mockResolvedValue(row("t-acme"))
    const c = await getOidcConnection("t-acme")
    expect(findUniqueMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "t-acme" } }))
    expect(c).toMatchObject({ id: "t-acme", tenantId: "t-acme", clientSecret: "plain:enc", allowedDomains: ["acme.example"] })
  })

  it("returns null for a missing row", async () => {
    findUniqueMock.mockResolvedValue(null)
    expect(await getOidcConnection("nope")).toBeNull()
  })
})

describe("listActiveOidcConnections", () => {
  it("keeps enabled, complete connections of enabled tenants, provider first", async () => {
    findManyMock.mockResolvedValue([
      row("t-acme"),
      row("t-off", { enabled: false }),
      row("t-noclient", { clientId: "" }),
      row("t-noissuer", { issuerUrl: "" }),
      row("t-disabled-tenant", { tenant: { enabled: false } }),
      row("default"),
    ])
    const ids = (await listActiveOidcConnections()).map(c => c.id)
    expect(ids).toEqual(["default", "t-acme"])
  })
})

describe("getActiveTenantConnectionBySlug", () => {
  it("returns the live connection of the tenant behind the slug", async () => {
    tenantFindUniqueMock.mockResolvedValue({ id: "t-acme", enabled: true })
    findUniqueMock.mockResolvedValue(row("t-acme"))
    expect((await getActiveTenantConnectionBySlug("acme"))?.id).toBe("t-acme")
    expect(tenantFindUniqueMock).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "acme" } }))
  })

  it("never reaches the provider connection through a slug", async () => {
    tenantFindUniqueMock.mockResolvedValue({ id: "default", enabled: true })
    findUniqueMock.mockResolvedValue(row("default"))
    expect(await getActiveTenantConnectionBySlug("default")).toBeNull()
  })

  it("returns null for an unknown slug, a disabled tenant or an inactive connection", async () => {
    tenantFindUniqueMock.mockResolvedValueOnce(null)
    expect(await getActiveTenantConnectionBySlug("ghost")).toBeNull()

    tenantFindUniqueMock.mockResolvedValueOnce({ id: "t-acme", enabled: false })
    expect(await getActiveTenantConnectionBySlug("acme")).toBeNull()

    tenantFindUniqueMock.mockResolvedValueOnce({ id: "t-acme", enabled: true })
    findUniqueMock.mockResolvedValueOnce(row("t-acme", { enabled: false }))
    expect(await getActiveTenantConnectionBySlug("acme")).toBeNull()
  })

  it("ignores an empty or oversized slug without querying", async () => {
    expect(await getActiveTenantConnectionBySlug("")).toBeNull()
    expect(await getActiveTenantConnectionBySlug("x".repeat(200))).toBeNull()
    expect(tenantFindUniqueMock).not.toHaveBeenCalled()
  })
})

describe("loginPathOfConnection", () => {
  it("is /login for the provider IdP and /login/<slug> for a tenant's", async () => {
    const { loginPathOfConnection } = await import("./oidcConnections")
    expect(await loginPathOfConnection("default")).toBe("/login")
    tenantFindUniqueMock.mockResolvedValueOnce({ slug: "acme corp" })
    expect(await loginPathOfConnection("t-acme")).toBe("/login/acme%20corp")
    tenantFindUniqueMock.mockResolvedValueOnce(null)
    expect(await loginPathOfConnection("t-gone")).toBe("/login")
  })
})

describe("strictUrls", () => {
  it("checks every tenant connection, unless the provider trusts its IdP, and never the provider's own", async () => {
    findManyMock.mockResolvedValue([
      row("default", { tenant: { enabled: true, oidcSelfService: false } }),
      row("t-open", { tenant: { enabled: true, oidcSelfService: true } }),
      row("t-closed", { tenant: { enabled: true, oidcSelfService: false } }),
      row("t-trusted", { trustedEndpoints: true, tenant: { enabled: true, oidcSelfService: false } }),
      row("t-open-trusted", { trustedEndpoints: true, tenant: { enabled: true, oidcSelfService: true } }),
    ])
    const byId = Object.fromEntries((await listActiveOidcConnections()).map(c => [c.id, c.strictUrls]))
    expect(byId).toEqual({ default: false, "t-open": true, "t-closed": true, "t-trusted": false, "t-open-trusted": true })
  })
})
