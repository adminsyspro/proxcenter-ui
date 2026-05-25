/**
 * Tests for the 5 user-facing 2FA routes.
 * Each route is dynamically imported AFTER mocks are set so Vitest's module
 * registry wires the fakes in correctly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

// ─── Mock factories ────────────────────────────────────────────────────────

const getServerSessionMock = vi.fn()
const getTokenMock = vi.fn()
const encodeMock = vi.fn()
const authenticatorCheckMock = vi.fn()

const userFindUniqueMock = vi.fn()
const transactionMock = vi.fn()
const recoveryCodeCountMock = vi.fn()

const generateTotpSecretMock = vi.fn()
const buildOtpauthUrlMock = vi.fn()
const encryptTotpSecretMock = vi.fn()
const verifyTotpMock = vi.fn()

const signEnrollTokenMock = vi.fn()
const verifyEnrollTokenMock = vi.fn()

const decryptSecretMock = vi.fn()
const generateRecoveryCodesMock = vi.fn()
const isEnrollmentRequiredForMock = vi.fn()
const replaceRecoveryCodesMock = vi.fn()
const clearUserTotpMock = vi.fn()
const verifyReauthCredentialsMock = vi.fn()
const auditMock = vi.fn()
const qrToDataURLMock = vi.fn()

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("next-auth/jwt", () => ({ getToken: getTokenMock, encode: encodeMock }))

vi.mock("otplib", () => ({
  authenticator: { check: authenticatorCheckMock },
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    $transaction: transactionMock,
  },
}))

vi.mock("@/lib/auth/recovery", () => ({
  countRemainingRecoveryCodes: recoveryCodeCountMock,
  generateRecoveryCodes: generateRecoveryCodesMock,
}))

vi.mock("@/lib/auth/totp", () => ({
  generateTotpSecret: generateTotpSecretMock,
  buildOtpauthUrl: buildOtpauthUrlMock,
  encryptTotpSecret: encryptTotpSecretMock,
  verifyTotp: verifyTotpMock,
}))

vi.mock("@/lib/auth/enroll-token", () => ({
  signEnrollToken: signEnrollTokenMock,
  verifyEnrollToken: verifyEnrollTokenMock,
}))

vi.mock("@/lib/crypto/secret", () => ({
  decryptSecret: decryptSecretMock,
}))

vi.mock("@/lib/auth/enforce-2fa", () => ({
  isEnrollmentRequiredFor: isEnrollmentRequiredForMock,
}))

vi.mock("@/lib/auth/totp-admin", () => ({
  replaceRecoveryCodes: replaceRecoveryCodesMock,
  clearUserTotp: clearUserTotpMock,
  verifyReauthCredentials: verifyReauthCredentialsMock,
}))

vi.mock("@/lib/audit", () => ({ audit: auditMock }))

vi.mock("qrcode", () => ({ default: { toDataURL: qrToDataURLMock } }))

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeSession(overrides: Record<string, any> = {}) {
  return {
    user: { id: "user-1", email: "user@example.com", ...overrides },
  }
}

// ─── GET /api/v1/auth/2fa/status ───────────────────────────────────────────

describe("GET /api/v1/auth/2fa/status", () => {
  beforeEach(() => vi.clearAllMocks())

  async function importGET() {
    const mod = await import("../status/route")
    return mod.GET
  }

  it("returns 401 when no session", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(401)
  })

  it("returns 200 with enabled=false and 0 recovery codes when not enrolled", async () => {
    getServerSessionMock.mockResolvedValue(makeSession())
    userFindUniqueMock.mockResolvedValue({ totpEnabled: false, totpEnrolledAt: null })

    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.enabled).toBe(false)
    expect(body.data.recoveryCodesRemaining).toBe(0)
  })

  it("returns 200 with enabled=true and remaining code count when enrolled", async () => {
    const enrolledAt = new Date("2024-06-01T00:00:00Z")
    getServerSessionMock.mockResolvedValue(makeSession())
    userFindUniqueMock.mockResolvedValue({ totpEnabled: true, totpEnrolledAt: enrolledAt })
    recoveryCodeCountMock.mockResolvedValue(7)

    const GET = await importGET()
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.enabled).toBe(true)
    expect(body.data.enrolledAt).toBe(enrolledAt.toISOString())
    expect(body.data.recoveryCodesRemaining).toBe(7)
  })
})

// ─── POST /api/v1/auth/2fa/enroll/start ───────────────────────────────────

describe("POST /api/v1/auth/2fa/enroll/start", () => {
  beforeEach(() => vi.clearAllMocks())

  async function importPOST() {
    const mod = await import("../enroll/start/route")
    return mod.POST
  }

  it("returns 401 when no session", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const POST = await importPOST()
    const res = await callRoute(POST as any)
    expect(res.status).toBe(401)
  })

  it("returns 401 when session has no email", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1", email: null } })
    const POST = await importPOST()
    const res = await callRoute(POST as any)
    expect(res.status).toBe(401)
  })

  it("returns 200 with secret, otpauthUrl, qrDataUrl, enrollToken on success", async () => {
    getServerSessionMock.mockResolvedValue(makeSession())
    generateTotpSecretMock.mockReturnValue("RAWSECRET")
    buildOtpauthUrlMock.mockReturnValue("otpauth://totp/ProxCenter:user@example.com?secret=RAWSECRET")
    encryptTotpSecretMock.mockReturnValue("enc:RAWSECRET")
    qrToDataURLMock.mockResolvedValue("data:image/png;base64,abc123")
    signEnrollTokenMock.mockResolvedValue("jwt-enroll-token")

    const POST = await importPOST()
    const res = await callRoute(POST as any)
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    expect(body.data.secret).toBe("RAWSECRET")
    expect(body.data.otpauthUrl).toContain("RAWSECRET")
    expect(body.data.qrDataUrl).toBe("data:image/png;base64,abc123")
    expect(body.data.enrollToken).toBe("jwt-enroll-token")
    expect(signEnrollTokenMock).toHaveBeenCalledWith(
      { userId: "user-1", secretEnc: "enc:RAWSECRET" },
      expect.any(String),
    )
  })
})

// ─── POST /api/v1/auth/2fa/enroll/verify ──────────────────────────────────

describe("POST /api/v1/auth/2fa/enroll/verify", () => {
  beforeEach(() => vi.clearAllMocks())

  async function importPOST() {
    const mod = await import("../enroll/verify/route")
    return mod.POST
  }

  it("returns 401 when no session", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { enrollToken: "tok", code: "123456" } })
    expect(res.status).toBe(401)
  })

  it("returns 400 with enroll_token_expired when verifyEnrollToken throws", async () => {
    getServerSessionMock.mockResolvedValue(makeSession())
    verifyEnrollTokenMock.mockRejectedValue(new Error("expired"))

    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { enrollToken: "bad-tok", code: "123456" } })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toBe("enroll_token_expired")
  })

  it("returns 400 with user_mismatch when token userId differs from session", async () => {
    getServerSessionMock.mockResolvedValue(makeSession({ id: "user-1" }))
    verifyEnrollTokenMock.mockResolvedValue({ userId: "user-OTHER", secretEnc: "enc:SECRET" })

    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { enrollToken: "tok", code: "123456" } })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toBe("user_mismatch")
  })

  it("returns 400 with invalid_code when authenticator.check returns false", async () => {
    getServerSessionMock.mockResolvedValue(makeSession({ id: "user-1" }))
    verifyEnrollTokenMock.mockResolvedValue({ userId: "user-1", secretEnc: "enc:SECRET" })
    decryptSecretMock.mockReturnValue("SECRET")
    authenticatorCheckMock.mockReturnValue(false)

    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { enrollToken: "tok", code: "999999" } })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toBe("invalid_code")
  })

  it("returns 200 with recovery codes and sets cookie on success", async () => {
    getServerSessionMock.mockResolvedValue(makeSession({ id: "user-1" }))
    verifyEnrollTokenMock.mockResolvedValue({ userId: "user-1", secretEnc: "enc:SECRET" })
    decryptSecretMock.mockReturnValue("SECRET")
    authenticatorCheckMock.mockReturnValue(true)
    generateRecoveryCodesMock.mockReturnValue(["CODE1-AAAAA", "CODE2-BBBBB"])
    // $transaction calls its callback with a stub tx
    transactionMock.mockImplementation((cb: (tx: any) => Promise<any>) =>
      cb({
        user: { update: vi.fn().mockResolvedValue({}) },
        userTotpRecoveryCode: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
      }),
    )
    replaceRecoveryCodesMock.mockResolvedValue(undefined)
    auditMock.mockResolvedValue(undefined)
    getTokenMock.mockResolvedValue({ sub: "user-1", mustEnroll2fa: true })
    encodeMock.mockResolvedValue("new-jwt-token")

    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { enrollToken: "tok", code: "123456" } })
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    expect(body.data.recoveryCodes).toEqual(["CODE1-AAAAA", "CODE2-BBBBB"])

    // Cookie should be set on the response
    const setCookie = res.headers.get("set-cookie")
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain("next-auth.session-token")

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "2fa_enrolled" }),
    )
  })
})

// ─── POST /api/v1/auth/2fa/disable ────────────────────────────────────────

describe("POST /api/v1/auth/2fa/disable", () => {
  beforeEach(() => vi.clearAllMocks())

  async function importPOST() {
    const mod = await import("../disable/route")
    return mod.POST
  }

  it("returns 401 when no session", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { password: "pw" } })
    expect(res.status).toBe(401)
  })

  it("returns 409 POLICY_LOCK when enrollment is required", async () => {
    getServerSessionMock.mockResolvedValue(makeSession())
    isEnrollmentRequiredForMock.mockResolvedValue(true)

    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { password: "pw" } })
    expect(res.status).toBe(409)
    const body = await readJson<any>(res)
    expect(body.code).toBe("POLICY_LOCK")
  })

  it("returns 400 when 2FA is not enabled", async () => {
    getServerSessionMock.mockResolvedValue(makeSession())
    isEnrollmentRequiredForMock.mockResolvedValue(false)
    userFindUniqueMock.mockResolvedValue({ password: "hashedpw", totpEnabled: false })

    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { password: "pw" } })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toBe("2FA is not enabled")
  })

  it("returns 401 when re-auth fails", async () => {
    getServerSessionMock.mockResolvedValue(makeSession())
    isEnrollmentRequiredForMock.mockResolvedValue(false)
    userFindUniqueMock.mockResolvedValue({ password: "hashedpw", totpEnabled: true })
    verifyReauthCredentialsMock.mockResolvedValue(false)

    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { password: "wrongpw" } })
    expect(res.status).toBe(401)
  })

  it("returns 200 and clears TOTP on success", async () => {
    getServerSessionMock.mockResolvedValue(makeSession())
    isEnrollmentRequiredForMock.mockResolvedValue(false)
    userFindUniqueMock.mockResolvedValue({ password: "hashedpw", totpEnabled: true })
    verifyReauthCredentialsMock.mockResolvedValue(true)
    transactionMock.mockImplementation((cb: (tx: any) => Promise<any>) =>
      cb({
        user: { update: vi.fn().mockResolvedValue({}) },
        userTotpRecoveryCode: { deleteMany: vi.fn().mockResolvedValue({}) },
      }),
    )
    clearUserTotpMock.mockResolvedValue(undefined)
    auditMock.mockResolvedValue(undefined)

    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { password: "correctpw" } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.ok).toBe(true)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "2fa_disabled" }),
    )
  })
})

// ─── POST /api/v1/auth/2fa/recovery-codes/regenerate ──────────────────────

describe("POST /api/v1/auth/2fa/recovery-codes/regenerate", () => {
  beforeEach(() => vi.clearAllMocks())

  async function importPOST() {
    const mod = await import("../recovery-codes/regenerate/route")
    return mod.POST
  }

  it("returns 401 when no session", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { totpCode: "123456" } })
    expect(res.status).toBe(401)
  })

  it("returns 400 when 2FA is not enabled", async () => {
    getServerSessionMock.mockResolvedValue(makeSession())
    userFindUniqueMock.mockResolvedValue({ password: "hashedpw", totpEnabled: false })

    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { totpCode: "123456" } })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toBe("2FA is not enabled")
  })

  it("returns 401 when re-auth fails", async () => {
    getServerSessionMock.mockResolvedValue(makeSession())
    userFindUniqueMock.mockResolvedValue({ password: "hashedpw", totpEnabled: true })
    verifyReauthCredentialsMock.mockResolvedValue(false)

    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { totpCode: "000000" } })
    expect(res.status).toBe(401)
  })

  it("returns 200 with fresh codes on success", async () => {
    getServerSessionMock.mockResolvedValue(makeSession())
    userFindUniqueMock.mockResolvedValue({ password: "hashedpw", totpEnabled: true })
    verifyReauthCredentialsMock.mockResolvedValue(true)
    generateRecoveryCodesMock.mockReturnValue(["NEWCO-DE001", "NEWCO-DE002"])
    transactionMock.mockImplementation((cb: (tx: any) => Promise<any>) =>
      cb({
        userTotpRecoveryCode: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
      }),
    )
    replaceRecoveryCodesMock.mockResolvedValue(undefined)
    auditMock.mockResolvedValue(undefined)

    const POST = await importPOST()
    const res = await callRoute(POST as any, { body: { totpCode: "123456" } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.recoveryCodes).toEqual(["NEWCO-DE001", "NEWCO-DE002"])
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "2fa_recovery_regenerated" }),
    )
  })
})
