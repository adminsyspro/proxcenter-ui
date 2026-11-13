/**
 * A tenant's own IdP stays inside its tenant (issue #1289): e-mail domains,
 * which roles it may grant, and which mapping rows survive.
 */
import { describe, expect, it } from "vitest"

import type { GroupGrant } from "./groupMapping"
import {
  confineTenantGrants,
  isEmailDomainAllowed,
  normalizeAllowedDomains,
  TENANT_DEFAULT_ROLE_ID,
  tenantRoleRefusal,
} from "./tenantOidc"

const T = "t-acme"

describe("normalizeAllowedDomains", () => {
  it("lowercases, strips the @, dedupes, from text or a list", () => {
    expect(normalizeAllowedDomains(" @ACME.fr ,acme.fr\nother.example ")).toEqual(["acme.fr", "other.example"])
    expect(normalizeAllowedDomains(["Acme.FR", "@acme.fr"])).toEqual(["acme.fr"])
  })

  it("drops what is not a domain name", () => {
    expect(normalizeAllowedDomains(["localhost", "a b.fr", "-x.fr", "*.acme.fr", "acme.fr/x", 42, null])).toEqual([])
  })

  it("reads anything else as no restriction", () => {
    expect(normalizeAllowedDomains(undefined)).toEqual([])
    expect(normalizeAllowedDomains({ acme: true })).toEqual([])
  })
})

describe("isEmailDomainAllowed", () => {
  it("accepts any address when the list is empty", () => {
    expect(isEmailDomainAllowed("a@anything.example", [])).toBe(true)
  })

  it("matches the exact domain, case-insensitively", () => {
    expect(isEmailDomainAllowed("a@Acme.FR", ["acme.fr"])).toBe(true)
  })

  it("refuses a subdomain, a look-alike suffix and a malformed address", () => {
    expect(isEmailDomainAllowed("a@sub.acme.fr", ["acme.fr"])).toBe(false)
    expect(isEmailDomainAllowed("a@acme.fr.evil.example", ["acme.fr"])).toBe(false)
    expect(isEmailDomainAllowed("a@evilacme.fr", ["acme.fr"])).toBe(false)
    expect(isEmailDomainAllowed("acme.fr", ["acme.fr"])).toBe(false)
    expect(isEmailDomainAllowed("a@b@acme.fr", ["acme.fr"])).toBe(false)
  })
})

describe("tenantRoleRefusal", () => {
  it("accepts the tenant roles and the tenant's own custom roles", () => {
    expect(tenantRoleRefusal({ id: "role_tenant_operator", tenantId: null }, T)).toBeNull()
    expect(tenantRoleRefusal({ id: "role_custom", tenantId: T }, T)).toBeNull()
  })

  it("refuses provider roles, wildcard roles, unknown roles and other tenants' roles", () => {
    expect(tenantRoleRefusal({ id: "role_super_admin", tenantId: null }, T)).toBe("provider_role")
    expect(tenantRoleRefusal({ id: "role_provider_admin", tenantId: null }, T)).toBe("provider_role")
    expect(tenantRoleRefusal({ id: "role_viewer", tenantId: null }, T)).toBe("provider_role")
    expect(tenantRoleRefusal({ id: "role_operator", tenantId: null }, T)).toBe("provider_role")
    expect(tenantRoleRefusal(null, T)).toBe("unknown_role")
    expect(tenantRoleRefusal({ id: "role_custom", tenantId: "t-other" }, T)).toBe("unknown_role")
  })

  it("refuses a tenant role that carries the NIC identity rights only a super admin grants", () => {
    const nic = { id: "role_t_net", tenantId: T, permissions: [{ permissionId: "vm.view" }, { permissionId: "vm.config.nic.vlan" }] }
    expect(tenantRoleRefusal(nic, T)).toBe("sensitive_role")
    expect(tenantRoleRefusal({ ...nic, permissions: [{ permissionId: "vm.view" }] }, T)).toBeNull()
  })

  it("accepts a provider catalogue role a tenant admin may assign there, published to this tenant (ui#1336)", () => {
    const catalogue = { id: "role_cat", tenantId: "default", isSystem: false, audience: "tenant" }
    expect(tenantRoleRefusal({ ...catalogue, publications: [{ tenantId: T }] }, T)).toBeNull()
    expect(tenantRoleRefusal({ ...catalogue, publishAll: true }, T)).toBeNull()
    expect(tenantRoleRefusal({ ...catalogue, publications: [{ tenantId: "t-other" }] }, T)).toBe("unknown_role")
    expect(tenantRoleRefusal({ ...catalogue, audience: "service_desk", publications: [{ tenantId: T }] }, T)).toBe("unknown_role")
    expect(tenantRoleRefusal({ ...catalogue, audience: "provider", publishAll: true }, T)).toBe("unknown_role")
    // A legacy provider role grandfathered to this tenant for the provider's SSO only.
    expect(tenantRoleRefusal({ ...catalogue, audience: null, publications: [{ tenantId: T }] }, T)).toBe("unknown_role")
  })

  it("defaults a tenant connection to the tenant viewer role", () => {
    expect(TENANT_DEFAULT_ROLE_ID).toBe("role_tenant_viewer")
  })
})

describe("confineTenantGrants", () => {
  const roles = new Map([
    ["role_tenant_operator", { id: "role_tenant_operator", tenantId: null }],
    ["role_tenant_viewer", { id: "role_tenant_viewer", tenantId: null }],
    ["role_super_admin", { id: "role_super_admin", tenantId: null }],
    ["role_viewer", { id: "role_viewer", tenantId: null }],
    ["role_acme_ops", { id: "role_acme_ops", tenantId: T }],
    ["role_other_ops", { id: "role_other_ops", tenantId: "t-other" }],
    ["role_acme_mac", { id: "role_acme_mac", tenantId: T, permissions: [{ permissionId: "vm.config.nic.mac" }] }],
  ])
  const vdcOwner = new Map([
    ["vdc-acme", T],
    ["vdc-other", "t-other"],
  ])
  const g = (group: string, role: string, tenantId = T, vdcId: string | null = null): GroupGrant => ({ group, tenantId, vdcId, role })

  it("keeps rows of the tenant with a tenant role, in order", () => {
    const kept = confineTenantGrants(
      [g("ops", "role_tenant_operator"), g("ops", "tenant_viewer", T, "vdc-acme"), g("own", "role_acme_ops")],
      T, roles, vdcOwner,
    )
    expect(kept.map(k => k.group)).toEqual(["ops", "ops", "own"])
  })

  it("drops every row that would reach outside the tenant or above a tenant role", () => {
    const kept = confineTenantGrants(
      [
        g("x", "role_tenant_operator", "t-other"),
        g("x", "role_tenant_operator", "default"),
        g("x", "role_tenant_operator", T, "vdc-other"),
        g("x", "role_tenant_operator", T, "vdc-gone"),
        g("x", "role_super_admin"),
        g("x", "super_admin"),
        g("x", "role_viewer"),
        g("x", "role_other_ops"),
        g("x", "role_does_not_exist"),
        g("x", "role_acme_mac"),
      ],
      T, roles, vdcOwner,
    )
    expect(kept).toEqual([])
  })
})
