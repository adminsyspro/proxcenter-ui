/**
 * Community super-admin grant (issues #512, #633, #755).
 *
 * A Community install runs the frontend alone, with no orchestrator, so its
 * licence verdict is never "resolved". Gating the auto-grant on a resolved
 * verdict therefore switched it off everywhere it was supposed to fire, and
 * every account created after the first one saw an empty UI (#755). The gate
 * must key on deployment shape instead, without reopening the escalation the
 * resolved check closed (#633): an Enterprise install whose orchestrator is
 * down, and an expired Enterprise licence, both still get nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const {
  getServerLicenseMock,
  auditMock,
  rbacUserRoleFindFirstMock,
  rbacUserRoleCreateMock,
  rbacUserPermissionFindFirstMock,
  userTenantFindFirstMock,
  userUpdateMock,
  transactionMock,
} = vi.hoisted(() => ({
  getServerLicenseMock: vi.fn(),
  auditMock: vi.fn(async () => {}),
  rbacUserRoleFindFirstMock: vi.fn(),
  rbacUserRoleCreateMock: vi.fn((args: any) => ({ __op: "rbacUserRole.create", args })),
  rbacUserPermissionFindFirstMock: vi.fn(),
  userTenantFindFirstMock: vi.fn(),
  userUpdateMock: vi.fn((args: any) => ({ __op: "user.update", args })),
  transactionMock: vi.fn(async (ops: any[]) => ops),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    rbacUserRole: { findFirst: rbacUserRoleFindFirstMock, create: rbacUserRoleCreateMock },
    rbacUserPermission: { findFirst: rbacUserPermissionFindFirstMock },
    userTenant: { findFirst: userTenantFindFirstMock },
    user: { update: userUpdateMock },
    $transaction: transactionMock,
  },
}))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))
vi.mock("./requireEnterprise", () => ({ getServerLicense: getServerLicenseMock }))

import {
  isCommunityDeployment,
  isOrchestratorConfigured,
  hasAnyActiveGrant,
  grantSuperAdmin,
  backfillCommunitySuperAdmin,
} from "./communitySuperAdmin"

import type { ServerLicense } from "./requireEnterprise"

/** An empty value means "no orchestrator configured", same as an unset var. */
const NO_ORCHESTRATOR = ""
const ORCHESTRATOR = "http://orchestrator:8080"

function licence(overrides: Partial<ServerLicense> = {}): ServerLicense {
  return {
    enterprise: false,
    edition: "community",
    licensed: false,
    expired: false,
    features: [],
    options: [],
    resolved: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  rbacUserRoleFindFirstMock.mockResolvedValue(null)
  rbacUserPermissionFindFirstMock.mockResolvedValue(null)
  userTenantFindFirstMock.mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("isOrchestratorConfigured", () => {
  it("reads the environment at call time, not at import time", () => {
    vi.stubEnv("ORCHESTRATOR_URL", NO_ORCHESTRATOR)
    expect(isOrchestratorConfigured()).toBe(false)

    vi.stubEnv("ORCHESTRATOR_URL", ORCHESTRATOR)
    expect(isOrchestratorConfigured()).toBe(true)
  })
})

describe("isCommunityDeployment", () => {
  const cases: Array<[string, ServerLicense, string, boolean]> = [
    ["community, verdict resolved, orchestrator present", licence({ resolved: true }), ORCHESTRATOR, true],
    ["community, verdict resolved, no orchestrator", licence({ resolved: true }), NO_ORCHESTRATOR, true],
    // The #755 regression: a real Community install can never resolve.
    ["community, unresolved, no orchestrator", licence(), NO_ORCHESTRATOR, true],
    // The #633 escalation: an Enterprise deployment whose orchestrator is down.
    ["community fallback while an orchestrator is configured", licence(), ORCHESTRATOR, false],
    [
      "expired enterprise licence",
      licence({ edition: "enterprise", licensed: true, expired: true, resolved: true }),
      ORCHESTRATOR,
      false,
    ],
    [
      "expired enterprise licence, orchestrator unreachable",
      licence({ edition: "enterprise", licensed: true, expired: true }),
      NO_ORCHESTRATOR,
      false,
    ],
    [
      "live enterprise licence",
      licence({ enterprise: true, edition: "enterprise", licensed: true, resolved: true }),
      ORCHESTRATOR,
      false,
    ],
  ]

  it.each(cases)("%s", (_label, lic, orchestrator, expected) => {
    vi.stubEnv("ORCHESTRATOR_URL", orchestrator)
    expect(isCommunityDeployment(lic)).toBe(expected)
  })
})

describe("hasAnyActiveGrant", () => {
  it("is true on a role grant", async () => {
    rbacUserRoleFindFirstMock.mockResolvedValue({ id: "grant-1" })
    expect(await hasAnyActiveGrant("u1")).toBe(true)
  })

  it("is true on a direct permission grant alone", async () => {
    rbacUserPermissionFindFirstMock.mockResolvedValue({ id: "perm-1" })
    expect(await hasAnyActiveGrant("u1")).toBe(true)
  })

  it("is false when the user holds neither", async () => {
    expect(await hasAnyActiveGrant("u1")).toBe(false)
  })

  it("ignores expired grants", async () => {
    await hasAnyActiveGrant("u1")

    for (const mock of [rbacUserRoleFindFirstMock, rbacUserPermissionFindFirstMock]) {
      const where = mock.mock.calls[0][0].where
      expect(where.userId).toBe("u1")
      expect(where.OR[0]).toEqual({ expiresAt: null })
      expect(where.OR[1].expiresAt.gt).toBeInstanceOf(Date)
    }
  })
})

describe("grantSuperAdmin", () => {
  it("files a global grant on the tenant the session will run in", async () => {
    userTenantFindFirstMock.mockResolvedValue({ tenantId: "tenant-b" })

    await grantSuperAdmin("u1")

    expect(userTenantFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", isDefault: true } }),
    )
    expect(rbacUserRoleCreateMock.mock.calls[0][0].data).toMatchObject({
      userId: "u1",
      roleId: "role_super_admin",
      scopeType: "global",
      scopeTarget: null,
      tenantId: "tenant-b",
    })
    expect(userUpdateMock.mock.calls[0][0]).toMatchObject({
      where: { id: "u1" },
      data: expect.objectContaining({ role: "super_admin" }),
    })
    // Grant and legacy column move together or not at all.
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(transactionMock.mock.calls[0][0]).toHaveLength(2)
  })

  it("falls back to the default tenant when the user has no default membership", async () => {
    await grantSuperAdmin("u1")

    expect(rbacUserRoleCreateMock.mock.calls[0][0].data.tenantId).toBe("default")
  })
})

describe("backfillCommunitySuperAdmin", () => {
  it("leaves a user who already holds a grant alone, without probing the licence", async () => {
    rbacUserRoleFindFirstMock.mockResolvedValue({ id: "grant-1" })
    vi.stubEnv("ORCHESTRATOR_URL", NO_ORCHESTRATOR)

    expect(await backfillCommunitySuperAdmin("u1")).toBe(false)
    expect(getServerLicenseMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("grants and audits a rights-less user on a Community install", async () => {
    getServerLicenseMock.mockResolvedValue(licence())
    vi.stubEnv("ORCHESTRATOR_URL", NO_ORCHESTRATOR)

    expect(await backfillCommunitySuperAdmin("u1")).toBe(true)
    expect(rbacUserRoleCreateMock.mock.calls[0][0].data).toMatchObject({
      userId: "u1",
      roleId: "role_super_admin",
    })
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: "u1",
        details: { superAdminGranted: true, reason: "community_backfill" },
      }),
    )
  })

  it("never escalates a rights-less user on an Enterprise deployment", async () => {
    getServerLicenseMock.mockResolvedValue(licence())
    vi.stubEnv("ORCHESTRATOR_URL", ORCHESTRATOR)

    expect(await backfillCommunitySuperAdmin("u1")).toBe(false)
    expect(transactionMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it("does nothing without a user id", async () => {
    expect(await backfillCommunitySuperAdmin("")).toBe(false)
    expect(rbacUserRoleFindFirstMock).not.toHaveBeenCalled()
  })
})
