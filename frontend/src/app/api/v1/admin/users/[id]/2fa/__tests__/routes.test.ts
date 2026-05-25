/**
 * Tests for the 3 admin 2FA routes.
 * Heavy lifting lives in totp-admin.ts helpers; these routes are thin wrappers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

// ─── Mock factories ────────────────────────────────────────────────────────

const getServerSessionMock = vi.fn()
const requireSuperAdminCallerMock = vi.fn()
const setUserRequire2faFlagMock = vi.fn()
const clearUserTotpMock = vi.fn()
const isEnrollmentRequiredForMock = vi.fn()
const auditMock = vi.fn()

const userFindUniqueMock = vi.fn()
const transactionMock = vi.fn()

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))

vi.mock("@/lib/auth/totp-admin", () => ({
  requireSuperAdminCaller: requireSuperAdminCallerMock,
  setUserRequire2faFlag: setUserRequire2faFlagMock,
  clearUserTotp: clearUserTotpMock,
}))

vi.mock("@/lib/auth/enforce-2fa", () => ({
  isEnrollmentRequiredFor: isEnrollmentRequiredForMock,
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    $transaction: transactionMock,
  },
}))

vi.mock("@/lib/audit", () => ({ audit: auditMock }))

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeSession(userId = "admin-1", email = "admin@example.com") {
  return { user: { id: userId, email } }
}

function deniedResponse(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

// ─── POST /admin/users/[id]/2fa/disable ───────────────────────────────────

describe("POST /admin/users/[id]/2fa/disable", () => {
  beforeEach(() => vi.clearAllMocks())

  async function importPOST() {
    const mod = await import("../disable/route")
    return mod.POST
  }

  it("returns 401 when requireSuperAdminCaller returns 401", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(deniedResponse(401, "Unauthorized"))
    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "target-1" } })
    expect(res.status).toBe(401)
  })

  it("returns 403 when requireSuperAdminCaller returns 403", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(deniedResponse(403, "Forbidden"))
    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "target-1" } })
    expect(res.status).toBe(403)
  })

  it("returns 409 POLICY_LOCK when admin tries to disable own 2FA that is policy-required", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(null)
    getServerSessionMock.mockResolvedValue(makeSession("admin-1"))
    isEnrollmentRequiredForMock.mockResolvedValue(true)

    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "admin-1" } })
    expect(res.status).toBe(409)
    const body = await readJson<any>(res)
    expect(body.error).toBe("POLICY_LOCK")
  })

  it("returns 400 when target user is not enrolled", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(null)
    getServerSessionMock.mockResolvedValue(makeSession("admin-1"))
    isEnrollmentRequiredForMock.mockResolvedValue(false)
    userFindUniqueMock.mockResolvedValue({ email: "target@example.com", totpEnabled: false })

    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "target-2" } })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toBe("2FA is not enabled on this user")
  })

  it("returns 200 and clears TOTP on success", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(null)
    getServerSessionMock.mockResolvedValue(makeSession("admin-1"))
    isEnrollmentRequiredForMock.mockResolvedValue(false)
    userFindUniqueMock.mockResolvedValue({ email: "target@example.com", totpEnabled: true })
    transactionMock.mockImplementation((cb: (tx: any) => Promise<any>) =>
      cb({
        user: { update: vi.fn().mockResolvedValue({}) },
        userTotpRecoveryCode: { deleteMany: vi.fn().mockResolvedValue({}) },
      }),
    )
    clearUserTotpMock.mockResolvedValue(undefined)
    auditMock.mockResolvedValue(undefined)

    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "target-2" } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.ok).toBe(true)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "2fa_disabled",
        details: { by: "admin" },
      }),
    )
  })

  it("skips POLICY_LOCK check when admin disables another user's 2FA", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(null)
    getServerSessionMock.mockResolvedValue(makeSession("admin-1"))
    isEnrollmentRequiredForMock.mockResolvedValue(true) // policy on for admin, but target is different
    userFindUniqueMock.mockResolvedValue({ email: "other@example.com", totpEnabled: true })
    transactionMock.mockImplementation((cb: (tx: any) => Promise<any>) =>
      cb({
        user: { update: vi.fn().mockResolvedValue({}) },
        userTotpRecoveryCode: { deleteMany: vi.fn().mockResolvedValue({}) },
      }),
    )
    clearUserTotpMock.mockResolvedValue(undefined)
    auditMock.mockResolvedValue(undefined)

    const POST = await importPOST()
    // target id is different from admin id — POLICY_LOCK won't fire
    const res = await callRoute(POST as any, { params: { id: "other-user" } })
    expect(res.status).toBe(200)
    // isEnrollmentRequiredFor should NOT have been called (target != session.user)
    expect(isEnrollmentRequiredForMock).not.toHaveBeenCalled()
  })
})

// ─── POST /admin/users/[id]/2fa/require ───────────────────────────────────

describe("POST /admin/users/[id]/2fa/require", () => {
  beforeEach(() => vi.clearAllMocks())

  async function importPOST() {
    const mod = await import("../require/route")
    return mod.POST
  }

  it("returns 401 when requireSuperAdminCaller returns 401", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(deniedResponse(401, "Unauthorized"))
    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "target-1" } })
    expect(res.status).toBe(401)
  })

  it("returns 403 when requireSuperAdminCaller returns 403", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(deniedResponse(403, "Forbidden"))
    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "target-1" } })
    expect(res.status).toBe(403)
  })

  it("returns 404 when setUserRequire2faFlag reports user not found", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(null)
    getServerSessionMock.mockResolvedValue(makeSession("admin-1"))
    setUserRequire2faFlagMock.mockResolvedValue(
      NextResponse.json({ error: "User not found" }, { status: 404 }),
    )

    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "missing-user" } })
    expect(res.status).toBe(404)
  })

  it("returns 200 on success and calls setUserRequire2faFlag with value=true", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(null)
    getServerSessionMock.mockResolvedValue(makeSession("admin-1", "admin@example.com"))
    setUserRequire2faFlagMock.mockResolvedValue(
      NextResponse.json({ data: { ok: true } }),
    )

    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "target-2" } })
    expect(res.status).toBe(200)

    expect(setUserRequire2faFlagMock).toHaveBeenCalledWith(
      "target-2",
      true,
      expect.objectContaining({ id: "admin-1", email: "admin@example.com" }),
    )
  })
})

// ─── POST /admin/users/[id]/2fa/clear-requirement ─────────────────────────

describe("POST /admin/users/[id]/2fa/clear-requirement", () => {
  beforeEach(() => vi.clearAllMocks())

  async function importPOST() {
    const mod = await import("../clear-requirement/route")
    return mod.POST
  }

  it("returns 401 when requireSuperAdminCaller returns 401", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(deniedResponse(401, "Unauthorized"))
    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "target-1" } })
    expect(res.status).toBe(401)
  })

  it("returns 403 when requireSuperAdminCaller returns 403", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(deniedResponse(403, "Forbidden"))
    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "target-1" } })
    expect(res.status).toBe(403)
  })

  it("returns 404 when setUserRequire2faFlag reports user not found", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(null)
    getServerSessionMock.mockResolvedValue(makeSession("admin-1"))
    setUserRequire2faFlagMock.mockResolvedValue(
      NextResponse.json({ error: "User not found" }, { status: 404 }),
    )

    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "missing-user" } })
    expect(res.status).toBe(404)
  })

  it("returns 200 on success and calls setUserRequire2faFlag with value=false", async () => {
    requireSuperAdminCallerMock.mockResolvedValue(null)
    getServerSessionMock.mockResolvedValue(makeSession("admin-1", "admin@example.com"))
    setUserRequire2faFlagMock.mockResolvedValue(
      NextResponse.json({ data: { ok: true } }),
    )

    const POST = await importPOST()
    const res = await callRoute(POST as any, { params: { id: "target-2" } })
    expect(res.status).toBe(200)

    expect(setUserRequire2faFlagMock).toHaveBeenCalledWith(
      "target-2",
      false,
      expect.objectContaining({ id: "admin-1", email: "admin@example.com" }),
    )
  })
})
