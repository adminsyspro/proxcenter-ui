// What a configuration backup holds: the tables an operator would have to
// rebuild by hand after losing the database, grouped by section for the
// preview. Both the frontend's tables and the orchestrator's live in the same
// Postgres database, so the orchestrator's configuration is listed here too.
//
// Left out on purpose: history and runtime state (audit log, sessions, alerts
// raised, usage samples, job runs, caches, leases), licences and the install
// identity (bound to this install's fingerprint, re-activated after a
// restore), the seeded permission catalogue, and the TOFU SSH host keys
// (pinned again on first contact).

export type BackupSectionKey = 'connections' | 'tenants' | 'access' | 'catalog' | 'monitoring' | 'automation' | 'general'

export interface BackupTable {
  /** Table name as Postgres knows it (case matters for the Prisma models without @@map). */
  name: string
  /** Rows kept in the export. */
  exportWhere?: string
  /**
   * Rows re-inserted on import, for a table pointing at one that is not part
   * of the backup: a row whose parent does not exist on this install is dropped
   * instead of failing the whole restore.
   */
  importWhere?: string
  /**
   * Rows the restore must never delete, updated in place from the file
   * instead. The provider tenant is one: a trigger forbids deleting it.
   */
  keepOnDelete?: string
  /**
   * Tables this one depends on without a foreign key: database triggers check
   * them on insert or delete (a connection needs its tenant, a vDC PBS binding
   * its PBS connection). Merged with the live foreign keys for the order.
   */
  after?: string[]
}

export interface BackupSection {
  key: BackupSectionKey
  tables: BackupTable[]
}

export const BACKUP_SECTIONS: BackupSection[] = [
  {
    key: 'connections',
    tables: [
      { name: 'Connection', after: ['tenants'] },
      { name: 'ManagedHost' },
      { name: 'provider_connections' },
      { name: 'sdn_vlan_zones' },
      { name: 'storage_policies' },
      { name: 'datacenters' },
      { name: 'connection_green_config' },
      { name: 'node_green_config' },
      { name: 'license_mappings', importWhere: 'license_id IN (SELECT id FROM licenses)' },
    ],
  },
  {
    key: 'tenants',
    tables: [
      { name: 'tenants', keepOnDelete: "id = 'default'" },
      { name: 'vdcs' },
      { name: 'vdc_nodes' },
      { name: 'vdc_storages' },
      { name: 'vdc_iso_libraries' },
      { name: 'vdc_quotas' },
      { name: 'vdc_shared_bridges' },
      { name: 'vdc_vnets' },
      { name: 'vdc_vlan_pools' },
      { name: 'vdc_storage_policies' },
      { name: 'tenant_networks' },
      { name: 'tenant_network_members' },
      { name: 'vdc_subnets' },
      { name: 'vdc_ipam_allocations' },
      { name: 'vdc_pbs_namespaces', after: ['Connection'] },
      { name: 'vdc_pbs_pve_storages' },
    ],
  },
  {
    key: 'access',
    tables: [
      { name: 'users' },
      { name: 'user_tenants' },
      { name: 'user_totp_recovery_codes' },
      { name: 'rbac_roles' },
      { name: 'rbac_role_permissions', importWhere: 'permission_id IN (SELECT id FROM rbac_permissions)' },
      { name: 'rbac_user_roles' },
      { name: 'rbac_user_permissions', importWhere: 'permission_id IN (SELECT id FROM rbac_permissions)' },
      { name: 'api_tokens' },
      { name: 'ldap_config' },
      { name: 'oidc_config' },
      { name: 'security_policies' },
    ],
  },
  {
    key: 'catalog',
    tables: [{ name: 'custom_images' }, { name: 'blueprints' }, { name: 'catalog_grants' }],
  },
  {
    key: 'monitoring',
    tables: [
      { name: 'alert_rules' },
      { name: 'alert_rule_owners' },
      { name: 'alert_silences' },
      { name: 'event_rules' },
      { name: 'notification_channels' },
      { name: 'report_schedules' },
      { name: 'compliance_profiles' },
      { name: 'compliance_profile_checks' },
      { name: 'broadcast_messages' },
      // The availability ledger the orchestrator writes is history: only the
      // SLA policies and the declared maintenance windows are configuration.
      { name: 'sla_policies' },
      { name: 'sla_maintenance_windows' },
    ],
  },
  {
    key: 'automation',
    tables: [
      { name: 'setting_records' },
      { name: 'affinity_rule_records' },
      { name: 'replication_jobs' },
      { name: 'recovery_plans' },
      { name: 'recovery_plan_guests' },
      { name: 'restore_drill_schedules' },
      { name: 'restore_drill_settings' },
      { name: 'sflow_expected_agents' },
    ],
  },
  {
    key: 'general',
    tables: [
      // Cursors and build/status caches are runtime state, not configuration.
      {
        name: 'settings',
        exportWhere: "key NOT IN ('syslog_orchestrator_cursor', 'templates.catalog.status', 'templates.catalog.builds')",
      },
      { name: 'uploaded_assets' },
      // The HTTPS certificates, uploaded ones included: the `tls` settings row
      // above points at the active one. ACME accounts, pending challenges and
      // the renewal lease are runtime state, rebuilt on the next order.
      { name: 'tls_certificates' },
      { name: 'DashboardLayout' },
      { name: 'user_preferences' },
      { name: 'favorites' },
    ],
  },
]

export const BACKUP_TABLES: BackupTable[] = BACKUP_SECTIONS.flatMap(section => section.tables)

/**
 * Orders tables so that every table comes after the tables it references
 * (insert order; delete in reverse). `references` maps a table to its parents;
 * parents outside `tables` and self-references are ignored. Ties keep the
 * input order, so the result is stable.
 */
export function orderForInsert(tables: string[], references: Map<string, Set<string>>): string[] {
  const included = new Set(tables)
  const ordered: string[] = []
  const placed = new Set<string>()
  const visiting = new Set<string>()

  const visit = (table: string) => {
    if (placed.has(table) || visiting.has(table)) return
    visiting.add(table)
    for (const parent of references.get(table) ?? []) {
      if (parent !== table && included.has(parent)) visit(parent)
    }
    visiting.delete(table)
    placed.add(table)
    ordered.push(table)
  }

  for (const table of tables) visit(table)
  return ordered
}
