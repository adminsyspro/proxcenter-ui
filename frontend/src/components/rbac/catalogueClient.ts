// src/components/rbac/catalogueClient.ts
//
// Client-side helpers of the provider role catalogue (ui#1336): the same rules
// as the server (lib/rbac/rolePublication), applied to the wire shape of
// GET /api/v1/rbac/roles.

import {
  buildTenantCeiling,
  isRoleAssignableInTenant,
  type PublishableRole,
  type RoleAudience,
} from '@/lib/rbac/rolePublication'

export type RoleWire = {
  id: string
  name: string
  is_system: boolean
  color?: string
  tenant_id?: string | null
  audience?: string | null
  publish_all?: boolean | null
  published_tenants?: string[] | null
  permissions?: { id: string; name?: string }[]
}

export type TenantOption = { id: string; name: string }

export function toPublishable(role: RoleWire): PublishableRole {
  return {
    isSystem: !!role.is_system,
    tenantId: role.tenant_id ?? null,
    audience: role.audience ?? null,
    publishAll: !!role.publish_all,
    publications: (role.published_tenants ?? []).map(tenantId => ({ tenantId })),
  }
}

/** Roles a provider can grant per tenant from the assignment dialog. */
export function isAssignableFromDialog(role: RoleWire, tenantId: string): boolean {
  return isRoleAssignableInTenant(toPublishable(role), tenantId)
}

export function isServiceDeskRole(role: RoleWire | null | undefined): boolean {
  return role?.audience === 'service_desk'
}

/** The tenants a service-desk role is published to, as options (all customer tenants when published to all). */
export function publishedTenantOptions(role: RoleWire | null | undefined, tenants: TenantOption[]): TenantOption[] {
  if (!role) return []
  const customers = tenants.filter(t => t.id !== 'default')
  if (role.publish_all) return customers
  const ids = new Set(role.published_tenants ?? [])
  return customers.filter(t => ids.has(t.id))
}

/** The ceiling, read from the Tenant Admin system role of the loaded role list. */
export function ceilingFromRoles(roles: RoleWire[]): Set<string> | null {
  const tenantAdmin = roles.find(r => r.id === 'role_tenant_admin')
  if (!tenantAdmin?.permissions) return null
  return buildTenantCeiling(tenantAdmin.permissions.map(p => p.name ?? p.id))
}

export const AUDIENCE_ICONS: Record<RoleAudience, string> = {
  provider: 'ri-building-2-line',
  service_desk: 'ri-customer-service-2-line',
  tenant: 'ri-team-line',
}

export const AUDIENCE_LABEL_KEYS: Record<RoleAudience, string> = {
  provider: 'rbacPage.catalogue.audienceProvider',
  service_desk: 'rbacPage.catalogue.audienceServiceDesk',
  tenant: 'rbacPage.catalogue.audienceTenant',
}

export const AUDIENCE_DESC_KEYS: Record<RoleAudience, string> = {
  provider: 'rbacPage.catalogue.audienceProviderDesc',
  service_desk: 'rbacPage.catalogue.audienceServiceDeskDesc',
  tenant: 'rbacPage.catalogue.audienceTenantDesc',
}
