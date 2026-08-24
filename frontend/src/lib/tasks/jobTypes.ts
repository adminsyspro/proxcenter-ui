/**
 * How a Task Center job type is named and pictured. Shared by the Task Center
 * page and the ProxCenter tab of the taskbar so both surfaces label the same
 * job identically.
 *
 * `site_recovery` replaced `maintenance` (#767): a failover, a failback or a
 * test failover is Site Recovery, and the old type made the column lie about
 * what the operator had run.
 */

export const JOB_TYPE_ICONS: Record<string, string> = {
  rolling_update: 'ri-refresh-line',
  replication: 'ri-repeat-line',
  drs: 'ri-exchange-line',
  // Same icon as the Site Recovery menu entry (menuData.js).
  site_recovery: 'ri-shield-star-line',
  migration: 'ri-swap-box-line',
}

export const JOB_TYPE_LABEL_KEYS: Record<string, string> = {
  rolling_update: 'jobsPage.typeRollingUpdate',
  replication: 'jobsPage.typeReplication',
  drs: 'jobsPage.typeDrs',
  site_recovery: 'jobsPage.typeSiteRecovery',
  migration: 'jobsPage.typeMigration',
}

/** Shown only if a type ever reaches the UI without a message-catalogue key. */
export const JOB_TYPE_FALLBACK_LABELS: Record<string, string> = {
  rolling_update: 'Rolling Update',
  replication: 'Replication',
  drs: 'DRS',
  site_recovery: 'Site Recovery',
  migration: 'Migration',
}

export const JOB_TYPE_FALLBACK_ICON = 'ri-file-list-line'

export function jobTypeIcon(type?: string): string {
  return (type && JOB_TYPE_ICONS[type]) || JOB_TYPE_FALLBACK_ICON
}
