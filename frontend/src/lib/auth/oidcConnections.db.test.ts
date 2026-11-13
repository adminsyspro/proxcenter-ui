/**
 * Per-tenant OIDC connections against a real Postgres schema (issue #1289).
 *
 * An identity is the pair (connection, subject): the same `sub` may exist under
 * two connections, never twice under one. A tenant's connection goes with the
 * tenant.
 */
import { beforeEach, describe, expect, it } from "vitest"

import { prismaTest, truncate } from "../../__tests__/setup/prisma-test"

const now = new Date()

async function tenant(id: string) {
  await prismaTest.tenant.upsert({
    where: { id },
    update: {},
    create: { id, slug: id, name: id, operatingModel: id === "default" ? null : "msp", createdAt: now, updatedAt: now },
  })
}

function user(id: string, oidcConnectionId: string | null, oidcSub: string | null) {
  return prismaTest.user.create({
    data: {
      id,
      email: `${id}@example.test`,
      authProvider: "oidc",
      oidcSub,
      oidcConnectionId,
      createdAt: now,
      updatedAt: now,
    },
  })
}

beforeEach(async () => {
  await truncate(["oidc_config", "user_tenants", "users"])
  await tenant("default")
  await tenant("t-acme")
})

describe("users (oidc_connection_id, oidc_sub)", () => {
  it("refuses the same subject twice under one connection", async () => {
    await user("u1", "t-acme", "sub-1")
    await expect(user("u2", "t-acme", "sub-1")).rejects.toMatchObject({ code: "P2002" })
  })

  it("accepts the same subject under two connections", async () => {
    await user("u1", "default", "sub-1")
    await expect(user("u2", "t-acme", "sub-1")).resolves.toMatchObject({ oidcConnectionId: "t-acme" })
  })

  it("leaves accounts without an identity unconstrained", async () => {
    await user("u1", null, null)
    await expect(user("u2", null, null)).resolves.toBeTruthy()
  })
})

describe("oidc_config per tenant", () => {
  it("allows one connection per tenant only", async () => {
    await prismaTest.oidcConfig.create({ data: { id: "t-acme", tenantId: "t-acme", createdAt: now, updatedAt: now } })
    await expect(
      prismaTest.oidcConfig.create({ data: { id: "other", tenantId: "t-acme", createdAt: now, updatedAt: now } }),
    ).rejects.toMatchObject({ code: "P2002" })
  })

  it("stores allowed domains as a list, empty by default", async () => {
    const row = await prismaTest.oidcConfig.create({ data: { id: "t-acme", tenantId: "t-acme", createdAt: now, updatedAt: now } })
    expect(row.allowedDomains).toEqual([])
  })

  it("deletes the connection of a deleted tenant", async () => {
    await prismaTest.oidcConfig.create({ data: { id: "t-acme", tenantId: "t-acme", createdAt: now, updatedAt: now } })
    await prismaTest.tenant.delete({ where: { id: "t-acme" } })
    expect(await prismaTest.oidcConfig.findUnique({ where: { id: "t-acme" } })).toBeNull()
  })

  it("trusts no tenant IdP's addresses by default", async () => {
    const row = await prismaTest.oidcConfig.create({ data: { id: "t-acme", tenantId: "t-acme", createdAt: now, updatedAt: now } })
    expect(row.trustedEndpoints).toBe(false)
  })

  it("keeps tenants closed to self-service by default", async () => {
    const row = await prismaTest.tenant.findUnique({ where: { id: "t-acme" } })
    expect(row?.oidcSelfService).toBe(false)
  })
})
