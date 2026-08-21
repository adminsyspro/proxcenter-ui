/**
 * Community super-admin backfill against a real Postgres schema (issue #755).
 *
 * The unit suite proves the decision logic; this one proves the write lands:
 * the grant row satisfies its foreign key to rbac_roles, it is filed on the
 * tenant the session will run in, the legacy column moves with it in the same
 * transaction, and a second sign-in does not stack a duplicate grant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { prismaTest, truncate } from "../../__tests__/setup/prisma-test"

const getServerLicenseMock = vi.fn()

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaTest }))
vi.mock("./requireEnterprise", () => ({ getServerLicense: getServerLicenseMock }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }))

const { backfillCommunitySuperAdmin } = await import("./communitySuperAdmin")

const TABLES = [
  "rbac_user_roles",
  "rbac_user_permissions",
  "user_tenants",
  "users",
  "rbac_roles",
  "tenants",
]

const COMMUNITY = {
  enterprise: false,
  edition: "community",
  licensed: false,
  expired: false,
  features: [],
  options: [],
  resolved: false,
}

async function seedInstall(tenantId = "default") {
  const now = new Date()

  await prismaTest.tenant.create({
    data: { id: tenantId, slug: tenantId, name: tenantId, createdAt: now, updatedAt: now },
  })
  await prismaTest.rbacRole.create({
    data: {
      id: "role_super_admin",
      name: "Super Admin",
      description: "Full access",
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    },
  })
}

async function seedRightsLessUser(id: string, tenantId = "default") {
  const now = new Date()

  await prismaTest.user.create({
    data: {
      id,
      email: `${id}@example.com`,
      password: "x",
      role: "user",
      authProvider: "credentials",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
  })
  await prismaTest.userTenant.create({
    data: { userId: id, tenantId, isDefault: true, joinedAt: now },
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  // No orchestrator configured: the shape of every Community install.
  vi.stubEnv("ORCHESTRATOR_URL", "")
  getServerLicenseMock.mockResolvedValue(COMMUNITY)
  await truncate(TABLES)
  await seedInstall()
})

describe("backfillCommunitySuperAdmin against Postgres", () => {
  it("repairs a rights-less account on the tenant it belongs to", async () => {
    const now = new Date()

    // Only the provider tenant may go without an operating model.
    await prismaTest.tenant.create({
      data: { id: "tenant-b", slug: "tenant-b", name: "B", operatingModel: "msp", createdAt: now, updatedAt: now },
    })
    await seedRightsLessUser("u1", "tenant-b")

    expect(await backfillCommunitySuperAdmin("u1")).toBe(true)

    const grants = await prismaTest.rbacUserRole.findMany({ where: { userId: "u1" } })
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({
      roleId: "role_super_admin",
      scopeType: "global",
      scopeTarget: null,
      tenantId: "tenant-b",
      expiresAt: null,
    })

    const user = await prismaTest.user.findUnique({ where: { id: "u1" } })
    expect(user?.role).toBe("super_admin")
  })

  it("is idempotent across sign-ins", async () => {
    await seedRightsLessUser("u2")

    expect(await backfillCommunitySuperAdmin("u2")).toBe(true)
    expect(await backfillCommunitySuperAdmin("u2")).toBe(false)
    expect(await prismaTest.rbacUserRole.count({ where: { userId: "u2" } })).toBe(1)
  })

  it("leaves an account that already holds a scoped role untouched", async () => {
    const now = new Date()

    await prismaTest.rbacRole.create({
      data: { id: "role_viewer", name: "Viewer", isSystem: true, createdAt: now, updatedAt: now },
    })
    await seedRightsLessUser("u3")
    await prismaTest.rbacUserRole.create({
      data: {
        id: "grant-u3",
        userId: "u3",
        roleId: "role_viewer",
        scopeType: "connection",
        scopeTarget: "conn-1",
        tenantId: "default",
        grantedAt: now,
      },
    })

    expect(await backfillCommunitySuperAdmin("u3")).toBe(false)

    const grants = await prismaTest.rbacUserRole.findMany({ where: { userId: "u3" } })
    expect(grants).toHaveLength(1)
    expect(grants[0].roleId).toBe("role_viewer")
    expect((await prismaTest.user.findUnique({ where: { id: "u3" } }))?.role).toBe("user")
  })

  it("repairs an account whose only grant has expired", async () => {
    const now = new Date()

    await prismaTest.rbacRole.create({
      data: { id: "role_operator", name: "Operator", isSystem: true, createdAt: now, updatedAt: now },
    })
    await seedRightsLessUser("u4")
    await prismaTest.rbacUserRole.create({
      data: {
        id: "grant-u4",
        userId: "u4",
        roleId: "role_operator",
        scopeType: "global",
        tenantId: "default",
        grantedAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    })

    expect(await backfillCommunitySuperAdmin("u4")).toBe(true)
    expect(
      await prismaTest.rbacUserRole.count({ where: { userId: "u4", roleId: "role_super_admin" } }),
    ).toBe(1)
  })

  it("writes nothing at all on an Enterprise deployment", async () => {
    vi.stubEnv("ORCHESTRATOR_URL", "http://orchestrator:8080")
    await seedRightsLessUser("u5")

    expect(await backfillCommunitySuperAdmin("u5")).toBe(false)
    expect(await prismaTest.rbacUserRole.count({ where: { userId: "u5" } })).toBe(0)
    expect((await prismaTest.user.findUnique({ where: { id: "u5" } }))?.role).toBe("user")
  })
})
