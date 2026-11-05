import { beforeEach, describe, expect, it, vi } from "vitest"

const { grantFindFirst, userFindFirst } = vi.hoisted(() => ({
  grantFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    rbacUserRole: { findFirst: grantFindFirst },
    user: { findFirst: userFindFirst },
  },
}))

import { isExternalProvider, isLastLocalSuperAdmin, localPasswordOnExternalSignIn } from "./localLogin"

const NOW = new Date("2026-11-05T12:00:00Z")

beforeEach(() => {
  vi.clearAllMocks()
})

describe("isExternalProvider", () => {
  it.each([
    ["oidc", true],
    ["ldap", true],
    ["credentials", false],
    [undefined, false],
    [null, false],
  ])("%s -> %s", (provider, expected) => {
    expect(isExternalProvider(provider as any)).toBe(expected)
  })
})

describe("isLastLocalSuperAdmin", () => {
  it("is false for an account that is not a super admin, without looking further", async () => {
    grantFindFirst.mockResolvedValue(null)

    expect(await isLastLocalSuperAdmin("u1", NOW)).toBe(false)
    expect(userFindFirst).not.toHaveBeenCalled()
  })

  it("is false when another enabled super admin can still sign in locally", async () => {
    grantFindFirst.mockResolvedValue({ id: "g1" })
    userFindFirst.mockResolvedValue({ id: "u2" })

    expect(await isLastLocalSuperAdmin("u1", NOW)).toBe(false)
    expect(userFindFirst).toHaveBeenCalledWith({
      where: {
        id: { not: "u1" },
        enabled: true,
        password: { not: null },
        OR: [{ authProvider: "credentials" }, { localLoginAllowed: true }],
        rolesAssigned: {
          some: { roleId: "role_super_admin", OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
        },
      },
      select: { id: true },
    })
  })

  it("is true when no other super admin keeps a local login", async () => {
    grantFindFirst.mockResolvedValue({ id: "g1" })
    userFindFirst.mockResolvedValue(null)

    expect(await isLastLocalSuperAdmin("u1", NOW)).toBe(true)
  })
})

describe("localPasswordOnExternalSignIn", () => {
  it("has nothing to do for an account without a local password", async () => {
    expect(await localPasswordOnExternalSignIn({ id: "u1", password: null, localLoginAllowed: false }, NOW))
      .toEqual({ data: {}, kept: null })
    expect(grantFindFirst).not.toHaveBeenCalled()
  })

  it("drops the local password of an ordinary account", async () => {
    grantFindFirst.mockResolvedValue(null)

    expect(await localPasswordOnExternalSignIn({ id: "u1", password: "h", localLoginAllowed: false }, NOW))
      .toEqual({ data: { password: null }, kept: null })
  })

  it("keeps the password of an account with emergency access", async () => {
    expect(await localPasswordOnExternalSignIn({ id: "u1", password: "h", localLoginAllowed: true }, NOW))
      .toEqual({ data: { localLoginAllowed: true }, kept: "emergency_access" })
    expect(grantFindFirst).not.toHaveBeenCalled()
  })

  it("keeps the password of the last super admin and marks it as emergency access", async () => {
    grantFindFirst.mockResolvedValue({ id: "g1" })
    userFindFirst.mockResolvedValue(null)

    expect(await localPasswordOnExternalSignIn({ id: "u1", password: "h", localLoginAllowed: false }, NOW))
      .toEqual({ data: { localLoginAllowed: true }, kept: "last_super_admin" })
  })
})
