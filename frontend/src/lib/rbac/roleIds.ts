// src/lib/rbac/roleIds.ts
//
// Role id lists with no dependency, so lib/auth can read them without pulling
// lib/rbac (which imports lib/tenant and the caches). lib/rbac re-exports them.

/**
 * Role IDs that must stay hidden from non-super-admin callers and may not be
 * assigned by anyone other than a super admin. Both grant wildcard permissions
 * (see seed in prisma/seed.ts); exposing either to a tenant admin lets them
 * escalate to full cluster access.
 */
export const PROTECTED_ROLE_IDS = ["role_super_admin", "role_provider_admin"] as const

/**
 * Roles meant for the provider tenant (or single-tenant Community installs)
 * and that grant `automation.view` (DRS / Site Recovery / Network Security /
 * Flows / Resources). Assigning them inside a non-default tenant unlocks
 * orchestration pages that Tenant Admin explicitly omits — see seed.ts where
 * role_tenant_admin's permission list comments why `automation.*` is dropped.
 *
 * Enforcement is twofold:
 *  - server-side: POST/PATCH /api/v1/rbac/assignments refuse to bind any of
 *    these to a tenantId other than `default` (see DEFAULT_TENANT_ID).
 *  - client-side: /security/rbac filters them out of the role dropdown when
 *    the target tenant isn't `default`.
 *
 * role_vm_user has no automation perms but stays here because it belongs to
 * the same legacy "global" role family — tenant operators should use the
 * tenant_* taxonomy (role_tenant_admin / role_tenant_operator /
 * role_tenant_viewer) which is the supported surface for vDC tenants.
 */
export const PROVIDER_ONLY_ROLE_IDS = [
  "role_operator",
  "role_vm_admin",
  "role_viewer",
  "role_vm_user",
] as const

/** Roles that can never be granted inside a customer tenant. */
export const TENANT_FORBIDDEN_ROLE_IDS: readonly string[] = [...PROVIDER_ONLY_ROLE_IDS, ...PROTECTED_ROLE_IDS]
