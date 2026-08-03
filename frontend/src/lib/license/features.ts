// Neutral license-feature module: importable from BOTH client components and
// server code (no 'use client', no React). Single source of truth for feature
// ids, edition mappings and the effective-feature computation (edition
// features + option capabilities union).

export const Features = {
  DRS: 'drs',
  FIREWALL: 'firewall',
  MICROSEGMENTATION: 'microsegmentation',
  ROLLING_UPDATES: 'rolling_updates',
  AI_INSIGHTS: 'ai_insights',
  PREDICTIVE_ALERTS: 'predictive_alerts',
  ALERTS: 'alerts',
  GREEN_METRICS: 'green_metrics',
  CROSS_CLUSTER_MIGRATION: 'cross_cluster_migration',
  VMWARE_MIGRATION: 'vmware_migration',
  CEPH_REPLICATION: 'ceph_replication',
  LDAP: 'ldap',
  REPORTS: 'reports',
  RBAC: 'rbac',
  TASK_CENTER: 'task_center',
  NOTIFICATIONS: 'notifications',
  CVE_SCANNER: 'cve_scanner',
  COMPLIANCE: 'compliance',
  OIDC: 'oidc',
  CHANGE_TRACKING: 'change_tracking',
  WHITE_LABEL: 'white_label',
  MULTI_TENANCY: 'multi_tenancy',
  SFLOW_MONITORING: 'sflow_monitoring',
  // Option capabilities (granted by stackable add-on licenses, never by an
  // edition). NEVER add these to EDITION_FEATURES.
  // ProxCenter control-plane HA (this paid add-on): multi-node conversion of
  // the ProxCenter application/database stack itself, VIP failover and
  // cluster health of ProxCenter's own control plane. Distinct from the free
  // Proxmox guest HA (VM/CT high availability on the managed Proxmox
  // cluster), which lives under the `connections/[id]/ha/**` routes and is
  // not gated by this capability.
  HA: 'control_plane_ha',
  // Read-only public API access via pxc_ service-account tokens (paid add-on,
  // spec 2026-07-28). Enforcement lives in getPrincipal(), UI gate in the
  // Settings API tab FeatureGuard.
  API_ACCESS: 'api_access',
} as const

export type FeatureId = (typeof Features)[keyof typeof Features]

// Moved verbatim from LicenseContext.tsx (lines 34-85). Features.HA is in neither.
export const EDITION_FEATURES: Record<string, readonly FeatureId[]> = {
  enterprise: [
    'drs',
    'firewall',
    'microsegmentation',
    'rolling_updates',
    'ai_insights',
    'predictive_alerts',
    'alerts',
    'green_metrics',
    'cross_cluster_migration',
    'vmware_migration',
    'ceph_replication',
    'ldap',
    'reports',
    'rbac',
    'task_center',
    'notifications',
    'cve_scanner',
    'compliance',
    'oidc',
    'change_tracking',
    'white_label',
    'multi_tenancy',
    'sflow_monitoring',
  ],
  enterprise_plus: [
    'drs',
    'firewall',
    'microsegmentation',
    'rolling_updates',
    'ai_insights',
    'predictive_alerts',
    'alerts',
    'green_metrics',
    'cross_cluster_migration',
    'vmware_migration',
    'ceph_replication',
    'ldap',
    'reports',
    'rbac',
    'task_center',
    'notifications',
    'cve_scanner',
    'compliance',
    'oidc',
    'change_tracking',
    'multi_tenancy',
    'sflow_monitoring',
  ],
}

export interface LicenseStatusLike {
  licensed?: boolean
  expired?: boolean
  edition?: string
  options?: string[]
}

export function isEnterpriseEdition(edition?: string): boolean {
  return edition === 'enterprise' || edition === 'enterprise_plus'
}

/**
 * Effective feature check shared by client (LicenseContext) and server
 * (requireFeature, inventory poller). Fail-closed: null/undefined status,
 * unlicensed or expired always deny. Option capabilities are only honored on
 * an Enterprise-tier edition (defense in depth: the backend already enforces
 * the same rule when computing the union).
 */
export function effectiveHasFeature(
  status: LicenseStatusLike | null | undefined,
  id: string,
): boolean {
  if (!status || status.licensed !== true || status.expired === true) return false
  const editionFeatures = EDITION_FEATURES[status.edition || '']
  if (editionFeatures?.includes(id as FeatureId)) return true
  return isEnterpriseEdition(status.edition) && (status.options ?? []).includes(id)
}

export interface OptionInfo {
  name: string
  description: string
  docsUrl: string
}

// Static registry of known option capabilities. Shipping a future paid option
// = one entry here + gating its UI (FeatureGuard), routes (requireFeature)
// and engine. Unknown ids coming from the backend are displayed raw.
export const OPTION_REGISTRY: Record<string, OptionInfo> = {
  control_plane_ha: {
    name: 'ProxCenter HA',
    description: 'High availability for the ProxCenter control plane itself: multi-node conversion, virtual IP failover and cluster health.',
    docsUrl: 'https://proxcenter.io/pricing',
  },
  api_access: {
    name: 'ProxCenter API Access',
    description: 'Read-only public API: autonomous service-account tokens for Prometheus, Zabbix, PRTG, CI and custom monitoring integrations.',
    docsUrl: 'https://proxcenter.io/pricing',
  },
}

export function optionDisplayName(id: string): string {
  return OPTION_REGISTRY[id]?.name ?? id
}
