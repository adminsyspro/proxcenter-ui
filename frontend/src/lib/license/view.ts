export interface PerLicenseUsage {
  license_id: string
  max_nodes: number
  used_nodes: number
  unlimited?: boolean
  exceeded?: boolean
  connections?: string[]
  is_primary?: boolean
}
export interface ImportedLicenseDTO {
  id: string
  license_id: string
  edition: string
  max_nodes: number
  cluster_uuid: string | null
  expires_at: string
  state: string
  connection_ids: string[]
  customer?: string
}
export interface LicenseTableRow {
  rowId: string
  licenseId: string
  role: 'primary' | 'import'
  licensedTo: string
  usedNodes: number
  maxNodes: number
  unlimited: boolean
  expiresAt: string | null
  clusterUuid: string | null
  connectionIds: string[]
  state: string
}
export interface TenantRollupRow {
  tenantId: string
  tenantName: string
  usedNodes: number
  maxNodes: number
  unlimited: boolean
  licenseIds: string[]
}

interface LicenseStatusLike {
  license_id?: string
  expires_at?: string
  customer?: { name?: string; company?: string }
  node_status?: { per_license?: PerLicenseUsage[] }
}

/**
 * Builds the rows for the all-licenses table: the primary (from status) plus
 * one row per imported license, joining per-license usage (used/max, from
 * node_status.per_license) with import metadata (expiry, cluster, connections,
 * from GET /license/imports). An import with no per_license entry (inert/expired)
 * shows used=0, max from its own max_nodes.
 */
export function buildLicenseTableRows(
  status: LicenseStatusLike,
  imports: ImportedLicenseDTO[],
): LicenseTableRow[] {
  const perLicense = status?.node_status?.per_license
  if (!Array.isArray(perLicense)) return []

  const usageByLicenseId = new Map<string, PerLicenseUsage>()
  for (const pl of perLicense) usageByLicenseId.set(pl.license_id, pl)

  const rows: LicenseTableRow[] = []

  const primaryUsage = perLicense.find(pl => pl.is_primary)
  if (primaryUsage) {
    rows.push({
      rowId: 'primary',
      licenseId: status.license_id || primaryUsage.license_id,
      role: 'primary',
      licensedTo: status.customer?.company || status.customer?.name || '',
      usedNodes: primaryUsage.used_nodes,
      maxNodes: primaryUsage.max_nodes,
      unlimited: !!primaryUsage.unlimited || primaryUsage.max_nodes <= 0,
      expiresAt: status.expires_at || null,
      clusterUuid: null,
      connectionIds: primaryUsage.connections || [],
      state: 'active',
    })
  }

  for (const imp of imports || []) {
    const usage = usageByLicenseId.get(imp.license_id)
    rows.push({
      rowId: imp.id,
      licenseId: imp.license_id,
      role: 'import',
      licensedTo: imp.customer || '',
      usedNodes: usage ? usage.used_nodes : 0,
      maxNodes: imp.max_nodes,
      unlimited: imp.max_nodes <= 0,
      expiresAt: imp.expires_at || null,
      clusterUuid: imp.cluster_uuid || null,
      connectionIds: imp.connection_ids || [],
      state: imp.state,
    })
  }

  return rows
}

/**
 * Per-tenant rollup for the reseller/MSP view: groups each NON-primary license
 * under the tenant that owns its connections (a connection's owning tenant =
 * its tenantId when != 'default'). Assumes one license maps to one client's
 * clusters (the intended MSP model). The primary (provider pool) is excluded.
 */
export function computePerTenantRollup(
  perLicense: PerLicenseUsage[],
  connToTenant: Record<string, string>,
  tenantNameMap: Record<string, string>,
): TenantRollupRow[] {
  const byTenant = new Map<string, TenantRollupRow>()
  for (const lic of perLicense || []) {
    if (lic.is_primary) continue
    const conns = lic.connections || []
    const owning =
      conns.map(c => connToTenant[c]).find(tid => tid && tid !== 'default') ||
      (conns.length ? connToTenant[conns[0]] : undefined) ||
      'default'
    const row = byTenant.get(owning) || {
      tenantId: owning,
      tenantName: tenantNameMap[owning] || owning,
      usedNodes: 0,
      maxNodes: 0,
      unlimited: false,
      licenseIds: [],
    }
    row.usedNodes += lic.used_nodes
    if (lic.unlimited || lic.max_nodes <= 0) row.unlimited = true
    else row.maxNodes += lic.max_nodes
    row.licenseIds.push(lic.license_id)
    byTenant.set(owning, row)
  }
  return Array.from(byTenant.values()).sort((a, b) => a.tenantName.localeCompare(b.tenantName))
}
