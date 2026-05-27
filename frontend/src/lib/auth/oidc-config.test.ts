/**
 * Tests for getOidcConfig / isOidcEnabled, covering the SSO-only flags
 * (showLocalLogin / forceSsoRedirect) carried through from the DB row.
 * Prisma and the secret crypto are mocked; the module is imported after.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const findUniqueMock = vi.fn()
const decryptSecretMock = vi.fn()

vi.mock("@/lib/db/prisma", () => ({
  prisma: { oidcConfig: { findUnique: findUniqueMock } },
}))

vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: decryptSecretMock }))

async function importMod() {
  return await import("./oidc")
}

function makeRow(overrides: Record<string, any> = {}) {
  return {
    enabled: true,
    providerName: "Okta",
    issuerUrl: "https://idp.example.com",
    clientId: "cid",
    clientSecretEnc: null,
    scopes: "openid profile email",
    authorizationUrl: null,
    tokenUrl: null,
    userinfoUrl: null,
    claimEmail: "email",
    claimName: "name",
    claimGroups: "groups",
    autoProvision: true,
    defaultRole: "viewer",
    groupRoleMapping: { admin: "role_admin" },
    showLocalLogin: false,
    forceSsoRedirect: true,
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe("getOidcConfig", () => {
  it("returns null when no config row exists", async () => {
    findUniqueMock.mockResolvedValue(null)
    const { getOidcConfig } = await importMod()
    expect(await getOidcConfig()).toBeNull()
  })

  it("maps the SSO-only flags from the row", async () => {
    findUniqueMock.mockResolvedValue(makeRow())
    const { getOidcConfig } = await importMod()
    const cfg = await getOidcConfig()
    expect(cfg?.showLocalLogin).toBe(false)
    expect(cfg?.forceSsoRedirect).toBe(true)
    expect(cfg?.groupRoleMapping).toEqual({ admin: "role_admin" })
    expect(cfg?.clientSecret).toBeNull()
  })

  it("decrypts the client secret when one is stored", async () => {
    findUniqueMock.mockResolvedValue(makeRow({ clientSecretEnc: "enc:abc" }))
    decryptSecretMock.mockReturnValue("plain-secret")
    const { getOidcConfig } = await importMod()
    const cfg = await getOidcConfig()
    expect(decryptSecretMock).toHaveBeenCalledWith("enc:abc")
    expect(cfg?.clientSecret).toBe("plain-secret")
  })
})

describe("isOidcEnabled", () => {
  it("is true only when the row is enabled", async () => {
    findUniqueMock.mockResolvedValue({ enabled: true })
    const { isOidcEnabled } = await importMod()
    expect(await isOidcEnabled()).toBe(true)
  })

  it("is false when there is no row", async () => {
    findUniqueMock.mockResolvedValue(null)
    const { isOidcEnabled } = await importMod()
    expect(await isOidcEnabled()).toBe(false)
  })
})
