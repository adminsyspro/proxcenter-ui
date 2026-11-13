// Which /settings tabs a user sees. A hidden tab never protects anything on its
// own: every gate here is doubled by its route's guard.
//
//   providerOnly             configures the provider itself: a super admin
//                            standing in the provider tenant.
//   superAdminOnly           configures the CURRENT tenant, super admin only
//                            (White Label).
//   customerTenantPermission configures the CURRENT customer tenant, for whoever
//                            holds that permission there (the tenant's own
//                            identity provider, issue #1289). Never shown in
//                            the provider tenant.
//   requiredFeature          licence gate, kept visible while the licence loads
//                            so a slow answer never makes tabs flicker away.

export type GatedTab = {
  providerOnly?: boolean
  superAdminOnly?: boolean
  customerTenantPermission?: string
  requiredFeature?: string
}

export type TabGateContext = {
  isSuperAdmin: boolean
  isProviderTenant: boolean
  licenseLoading: boolean
  hasFeature: (feature: string) => boolean
  hasPermission: (permission: string) => boolean
}

export function isSettingsTabVisible(tab: GatedTab, ctx: TabGateContext): boolean {
  if (tab.providerOnly && !(ctx.isSuperAdmin && ctx.isProviderTenant)) return false
  if (tab.superAdminOnly && !ctx.isSuperAdmin) return false
  if (tab.customerTenantPermission && (ctx.isProviderTenant || !ctx.hasPermission(tab.customerTenantPermission))) return false
  if (!ctx.licenseLoading && tab.requiredFeature && !ctx.hasFeature(tab.requiredFeature)) return false
  return true
}
