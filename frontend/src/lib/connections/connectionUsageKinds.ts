/**
 * The kinds of link that keep a connection from being deleted (ui#1394),
 * shared by the server check and the delete dialog. No server import here:
 * the dialog is a client component.
 */

export const BLOCKING_KINDS = [
  'tenantOwner',
  'vdcs',
  'pbsVdcs',
  'replicationJobs',
  'recoveryPlans',
  'microseg',
  'drsRules',
  'migrations',
  'vdcMoves',
  'complianceProfiles',
  'slaWindows',
  'restoreDrillSchedules',
  'logForwarders',
] as const

export type UsageKind = (typeof BLOCKING_KINDS)[number]

export interface ConnectionUsage {
  /** Links to remove before the deletion, by kind, as display names. */
  blocking: Partial<Record<UsageKind, string[]>>
  /** API tokens limited to this connection: they reach nothing once it goes. */
  apiTokens: string[]
}

export function isBlocked(usage: ConnectionUsage): boolean {
  return Object.values(usage.blocking).some(names => names && names.length > 0)
}
