/**
 * Tests for the singleton LDAP config route, focused on the CA certificate
 * added for issue #981: it must survive a round trip to the form, be refused
 * when it is not a PEM bundle, and clear itself when the field is emptied.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const checkPermissionMock = vi.fn()
const findUniqueMock = vi.fn()
const upsertMock = vi.fn()
const auditMock = vi.fn()

vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_SETTINGS: "admin.settings" },
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: { ldapConfig: { findUnique: findUniqueMock, upsert: upsertMock } },
}))

vi.mock("@/lib/crypto/secret", () => ({ encryptSecret: (v: string) => `enc:${v}` }))

vi.mock("@/lib/audit", () => ({ audit: auditMock }))

const savedRow = {
  enabled: true,
  url: "ldaps://dc.example.org:636",
  bindDn: "cn=admin,dc=example,dc=org",
  bindPasswordEnc: "enc:secret",
  baseDn: "dc=example,dc=org",
  userFilter: "(uid={{username}})",
  emailAttribute: "mail",
  nameAttribute: "cn",
  tlsInsecure: false,
  caCert: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
  groupAttribute: "memberOf",
  groupRoleMapping: {},
  defaultRole: "role_viewer",
  requireGroup: false,
  allowedGroups: [],
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    url: "ldaps://dc.example.org:636",
    base_dn: "dc=example,dc=org",
    ...overrides,
  }
}

async function routes() {
  return await import("../route")
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  findUniqueMock.mockResolvedValue(null)
  upsertMock.mockResolvedValue({})
})

describe("GET /api/v1/auth/ldap", () => {
  it("exposes an empty CA certificate when nothing is configured yet", async () => {
    const { GET } = await routes()
    const res = await callRoute(GET as any, { method: "GET" })
    const data = (await readJson<any>(res)).data
    expect(data.ca_cert).toBe("")
  })

  it("returns the stored CA certificate, unlike the bind password", async () => {
    findUniqueMock.mockResolvedValue(savedRow)
    const { GET } = await routes()
    const res = await callRoute(GET as any, { method: "GET" })
    const data = (await readJson<any>(res)).data
    expect(data.ca_cert).toBe(savedRow.caCert)
    expect(data.hasBindPassword).toBe(true)
    expect(data).not.toHaveProperty("bind_password")
  })
})

describe("PUT /api/v1/auth/ldap", () => {
  it("persists a pasted PEM bundle, trimmed", async () => {
    const { PUT } = await routes()
    const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----"
    const res = await callRoute(PUT as any, { method: "PUT", body: body({ ca_cert: `\n${pem}\n  ` }) })
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const call = upsertMock.mock.calls[0][0]
    expect(call.update.caCert).toBe(pem)
    expect(call.create.caCert).toBe(pem)
  })

  it("stores null when the field is left empty, so the system store is used again", async () => {
    const { PUT } = await routes()
    await callRoute(PUT as any, { method: "PUT", body: body({ ca_cert: "   " }) })
    expect(upsertMock.mock.calls[0][0].update.caCert).toBeNull()
  })

  it("refuses a value that is not a PEM bundle without touching the database", async () => {
    const { PUT } = await routes()
    const res = await callRoute(PUT as any, { method: "PUT", body: body({ ca_cert: "just a string" }) })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/PEM/)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it("records in the audit trail whether a CA certificate is in use, never its content", async () => {
    const { PUT } = await routes()
    const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----"
    await callRoute(PUT as any, { method: "PUT", body: body({ ca_cert: pem }) })
    const details = auditMock.mock.calls[0][0].details
    expect(details.caCert).toBe(true)
    expect(JSON.stringify(details)).not.toContain("BEGIN CERTIFICATE")
  })

  it("still refuses a configuration enabled without a URL", async () => {
    const { PUT } = await routes()
    const res = await callRoute(PUT as any, { method: "PUT", body: body({ url: "" }) })
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
