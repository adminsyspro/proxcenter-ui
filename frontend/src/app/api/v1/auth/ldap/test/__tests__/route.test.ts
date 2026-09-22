/**
 * Tests for the LDAP connection test route. The point of interest for issue
 * #981 is that the CA certificate pasted in the form reaches the orchestrator,
 * otherwise the button would answer "unknown authority" on a directory the
 * saved configuration can reach.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const checkPermissionMock = vi.fn()
const findUniqueMock = vi.fn()
const auditMock = vi.fn()

vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_SETTINGS: "admin.settings" },
}))

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
  checkPermissionMock.mockResolvedValue(null)
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
})
