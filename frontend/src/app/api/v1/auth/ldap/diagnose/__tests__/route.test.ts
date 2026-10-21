/**
 * The LDAP user lookup diagnostic route (roadmap#38): admin only, read-only,
 * no password sent to the orchestrator, and the form's (unsaved) policy is
 * what the evaluation uses.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const checkPermissionMock = vi.fn()
const ldapFindUniqueMock = vi.fn()
const userFindUniqueMock = vi.fn()
const roleFindFirstMock = vi.fn()
const auditMock = vi.fn()

vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_SETTINGS: "admin.settings" },
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    ldapConfig: { findUnique: ldapFindUniqueMock },
    user: { findUnique: userFindUniqueMock },
    rbacUserRole: { findFirst: roleFindFirstMock },
  },
}))

vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: (v: string) => v.replace(/^enc:/, "") }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))

const ADMINS = "cn=dcvCenter Admins,ou=groups,dc=r38,dc=lab"

const FORM = {
  url: "ldap://127.0.0.1:13389",
  bind_dn: "cn=readonly,dc=r38,dc=lab",
  bind_password: "",
  base_dn: "dc=r38,dc=lab",
  user_filter: "(&(sAMAccountName={{username}})(memberOf=CN=dcvCenter Admins,OU=Groups,DC=r38,DC=lab))",
  group_attribute: "memberOf",
  require_group: false,
  allowed_groups: [],
  group_role_mapping: [{ group: "dcvCenter Admins", role: "role_operator" }],
  default_role: "role_viewer",
  test_username: " alice ",
}

let fetchMock: ReturnType<typeof vi.fn>

function orchestratorAnswers(body: unknown, status = 200) {
  fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
  vi.stubGlobal("fetch", fetchMock)
}

async function post(body: unknown) {
  const { POST } = await import("../route")
  return callRoute(POST as any, { body })
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  ldapFindUniqueMock.mockResolvedValue({ bindPasswordEnc: "enc:saved-secret" })
  userFindUniqueMock.mockResolvedValue(null)
  roleFindFirstMock.mockResolvedValue(null)
  orchestratorAnswers({
    status: "found",
    username_placeholder: true,
    match_count: 1,
    password_checked: false,
    user: { dn: "uid=alice,ou=people,dc=r38,dc=lab", email: "Alice@r38.lab", name: "Alice", groups: [ADMINS] },
  })
})

describe("POST /api/v1/auth/ldap/diagnose", () => {
  it("is refused without the settings permission, before any lookup", async () => {
    checkPermissionMock.mockResolvedValue(new Response("forbidden", { status: 403 }))
    const res = await post(FORM)
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("requires a URL and a test username", async () => {
    expect((await post({ ...FORM, url: "" })).status).toBe(400)
    const res = await post({ ...FORM, test_username: "  " })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe("username_required")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("looks the user up with the saved bind password and never sends a user password", async () => {
    const res = await post({ ...FORM, password: "should-not-travel" })
    expect(res.status).toBe(200)
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as any).body)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/auth\/ldap\/lookup$/)
    expect(sent.username).toBe("alice")
    expect(sent.config.bind_password).toBe("saved-secret")
    expect(sent.password).toBeUndefined()
    expect(JSON.stringify(sent)).not.toContain("should-not-travel")
  })

  it("evaluates the form policy and reports a new account with its role", async () => {
    const res = await post(FORM)
    const { data } = await readJson<any>(res)
    expect(data.evaluation.blocker).toBeNull()
    expect(data.evaluation.role).toMatchObject({ roleId: "role_operator", matchedGroup: "dcvCenter Admins" })
    expect(data.account).toEqual({ exists: false, email: "alice@r38.lab" })
    expect(userFindUniqueMock).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "alice@r38.lab" } }))
  })

  it("reports an existing account and its LDAP-managed role, read-only", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "u1", enabled: true })
    roleFindFirstMock.mockResolvedValue({ roleId: "role_viewer" })
    const { data } = await readJson<any>(await post({ ...FORM, require_group: true, allowed_groups: ["ProxCenter-Users"] }))
    expect(data.account).toEqual({ exists: true, email: "alice@r38.lab", enabled: true, ldapRoleId: "role_viewer" })
    expect(data.evaluation.blocker).toBe("not_in_allowed_group")
  })

  it("audits the diagnostic without any secret", async () => {
    await post(FORM)
    expect(auditMock).toHaveBeenCalledTimes(1)
    const entry = auditMock.mock.calls[0][0]
    expect(entry.details).toEqual({ diagnostic: "user_lookup", test_username: "alice", status: "found", blocker: null })
    expect(JSON.stringify(entry)).not.toContain("secret")
  })

  it("names an orchestrator too old for the diagnostic", async () => {
    orchestratorAnswers({ error: "not found" }, 404)
    const res = await post(FORM)
    expect(res.status).toBe(501)
    expect((await readJson<any>(res)).error).toBe("orchestrator_outdated")
  })

  it("reports an orchestrator error or an unreachable orchestrator", async () => {
    orchestratorAnswers({ error: "boom" }, 500)
    expect((await readJson<any>(await post(FORM))).error).toBe("orchestrator_error")

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
    const res = await post(FORM)
    expect(res.status).toBe(502)
    expect((await readJson<any>(res)).error).toBe("orchestrator_unreachable")
  })

  it("skips the account read when no user was identified", async () => {
    orchestratorAnswers({ status: "invalid_filter", error: "ldap: unexpected end of filter", username_placeholder: false, match_count: 0, password_checked: false })
    const { data } = await readJson<any>(await post(FORM))
    expect(data.evaluation.blocker).toBe("invalid_filter")
    expect(data.account).toBeNull()
    expect(userFindUniqueMock).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/auth/ldap/diagnose English messages", () => {
  it("answers 'LDAP URL is required'", async () => {
    const res = await post({ ...FORM, url: "" })
    expect((await readJson<any>(res)).error).toBe("LDAP URL is required")
  })

  it("answers 'LDAP diagnosis failed' when an unexpected error has no message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    checkPermissionMock.mockRejectedValue({})
    const res = await post(FORM)
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toBe("LDAP diagnosis failed")
  })
})
