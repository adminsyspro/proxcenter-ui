/**
 * Tests for the LDAP connection test route. The point of interest for issue
 * #981 is that the CA certificate pasted in the form reaches the orchestrator,
 * otherwise the button would answer "unknown authority" on a directory the
 * saved configuration can reach.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const requireProviderAdminMock = vi.fn()
const findUniqueMock = vi.fn()
const auditMock = vi.fn()

vi.mock("@/lib/rbac", () => ({
  PERMISSIONS: { ADMIN_SETTINGS: "admin.settings" },
}))

// Provider-only route: requireProviderAdmin stands for the tenant gate AND
// admin.settings, so one mock covers both.
vi.mock("@/lib/tenant/providerGuard", () => ({ requireProviderAdmin: requireProviderAdminMock }))

vi.mock("@/lib/db/prisma", () => ({
  prisma: { ldapConfig: { findUnique: findUniqueMock } },
}))

vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: (v: string) => v.replace(/^enc:/, "") }))

vi.mock("@/lib/audit", () => ({ audit: auditMock }))

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----"

function orchestratorPayload() {
  return JSON.parse((fetchMock.mock.calls[0][1] as any).body as string)
}

let fetchMock: ReturnType<typeof vi.fn>

async function importPOST() {
  const mod = await import("../route")
  return mod.POST
}

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderAdminMock.mockResolvedValue(null)
  findUniqueMock.mockResolvedValue(null)
  fetchMock = vi.fn().mockResolvedValue({
    json: async () => ({ success: true, message: "LDAP connection successful" }),
  })
  vi.stubGlobal("fetch", fetchMock)
})

describe("POST /api/v1/auth/ldap/test", () => {
  it("forwards the CA certificate to the orchestrator", async () => {
    const POST = await importPOST()
    const res = await callRoute(POST as any, {
      body: { url: "ldaps://dc.example.org:636", base_dn: "dc=example,dc=org", ca_cert: PEM },
    })
    expect((await readJson<any>(res)).success).toBe(true)
    expect(orchestratorPayload().ca_cert).toBe(PEM)
  })

  it("sends an empty certificate when the form has none, keeping the system store", async () => {
    const POST = await importPOST()
    await callRoute(POST as any, { body: { url: "ldaps://dc.example.org:636" } })
    expect(orchestratorPayload().ca_cert).toBe("")
  })

  it("surfaces the orchestrator verdict as-is when the chain is not trusted", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ success: false, message: "Connection failed: unknown authority" }),
    })
    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { url: "ldaps://dc.example.org:636" } })
    const payload = await readJson<any>(res)
    expect(payload.success).toBe(false)
    expect(payload.error).toMatch(/unknown authority/)
  })

  it("rejects a request without a URL before calling the orchestrator", async () => {
    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { ca_cert: PEM } })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // roadmap#38: the verdict lists what was and was not checked.
  it("passes the orchestrator checks through, on success and on failure", async () => {
    const checks = [
      { id: "connect", status: "passed" },
      { id: "user_lookup", status: "not_checked" },
    ]
    fetchMock.mockResolvedValue({ json: async () => ({ success: true, message: "ok", checks }) })
    const POST = await importPOST()
    let payload = await readJson<any>(await callRoute(POST as any, { body: { url: "ldap://dc" } }))
    expect(payload.checks).toEqual(checks)

    fetchMock.mockResolvedValue({ json: async () => ({ success: false, message: "User filter is invalid", checks }) })
    payload = await readJson<any>(await callRoute(POST as any, { body: { url: "ldap://dc" } }))
    expect(payload).toMatchObject({ success: false, error: "User filter is invalid", checks })

    fetchMock.mockResolvedValue({ json: async () => ({ success: true, message: "LDAP connection successful" }) })
    payload = await readJson<any>(await callRoute(POST as any, { body: { url: "ldap://dc" } }))
    expect(payload.checks).toBeUndefined()
  })

  it("re-tests with the saved bind password when the form leaves it blank", async () => {
    findUniqueMock.mockResolvedValue({ bindPasswordEnc: "enc:saved" })
    const POST = await importPOST()
    await callRoute(POST as any, { body: { url: "ldap://dc", bind_dn: "cn=svc" } })
    expect(orchestratorPayload().bind_password).toBe("saved")
  })
})

describe("POST /api/v1/auth/ldap/test provider tenant", () => {
  it("refuses a customer tenant admin before the saved bind password or the orchestrator is touched", async () => {
    requireProviderAdminMock.mockResolvedValue(new Response("forbidden", { status: 403 }))
    const POST = await importPOST()
    const res = await callRoute(POST as any, { method: "POST", body: { url: "ldap://evil.example.org", bind_dn: "cn=admin" } })
    expect(res.status).toBe(403)
    expect(requireProviderAdminMock).toHaveBeenCalledWith("admin.settings")
    expect(findUniqueMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
