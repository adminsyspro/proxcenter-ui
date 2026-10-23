import { describe, expect, it, vi } from "vitest"

// lib/rbac pulls Prisma, the principal and the inventory caches in; only its
// constant is read here, so stub them the way lib/rbac/checkPermissions.test.ts does.
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/auth/principal", () => ({ getPrincipal: vi.fn(), rejectionToResponse: vi.fn() }))
vi.mock("@/lib/cache/vmMetaCache", () => ({ resolveVmMeta: vi.fn() }))
vi.mock("@/lib/cache/inventoryCache", () => ({ getTenantInventoriesFromCache: vi.fn() }))
vi.mock("@/lib/tenant", () => ({ DEFAULT_TENANT_ID: "default", getTenantConnectionIds: vi.fn() }))

import { PROTECTED_ROLE_IDS } from "@/lib/rbac"

import { PROTECTED_SSO_ROLE_IDS, normalizeRoleId, protectedRoleTargets } from "./groupMapping"

describe("protectedRoleTargets", () => {
  it("mirrors PROTECTED_ROLE_IDS of lib/rbac, the list the assignments route enforces", () => {
    expect([...PROTECTED_SSO_ROLE_IDS].sort()).toEqual([...PROTECTED_ROLE_IDS].sort())
  })

  it("normalises the bare OIDC spelling and the prefixed LDAP one alike", () => {
    expect(normalizeRoleId("viewer")).toBe("role_viewer")
    expect(normalizeRoleId(" role_viewer ")).toBe("role_viewer")
    expect(normalizeRoleId("")).toBe("")
    expect(normalizeRoleId(null)).toBe("")
  })

  it("returns the protected ids among a default role and mapping targets, once each", () => {
    expect(protectedRoleTargets(["viewer", "role_operator"])).toEqual([])
    expect(protectedRoleTargets(["super_admin", "role_super_admin", "provider_admin"])).toEqual([
      "role_super_admin",
      "role_provider_admin",
    ])
    expect(protectedRoleTargets([undefined, null, "", "role_provider_admin"])).toEqual(["role_provider_admin"])
  })
})
