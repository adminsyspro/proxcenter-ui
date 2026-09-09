// src/lib/migration/ccm-prereqs.types.ts
//
// Client-safe half of the cross-cluster migration prerequisites contract: the
// shapes exchanged between the migration dialog, the routes and the watcher,
// plus the one predicate the dialog needs at runtime.
//
// ⛔ Keep this module free of any server-only import. Its sibling
// `ccm-prereqs.ts` pulls @/lib/proxmox/client, which reaches Prisma and `pg`;
// importing a VALUE from there in a 'use client' component drags all of that
// into the browser bundle and breaks `next build` with a module-not-found on
// `pg`. `ccm-prereqs.ts` re-exports everything here, so server code can keep
// importing from a single place.

/** A ProxCenter Site Recovery job that covers this guest. */
export type SiteRecoveryJobRef = {
  id: string
  name: string
  /** Other guests in the same job, which a blind removal would break. */
  otherVmids: number[]
  /** The job selects its guests by tag, so the guest silently stops matching. */
  byTag: boolean
}

/** HA resource config worth replaying on another cluster. */
export type HaResourceCapture = {
  sid: string
  state?: string
  group?: string
  comment?: string
  maxRestart?: number
  maxRelocate?: number
  /** PVE booleans, kept as 0/1 exactly as the API reports them. */
  failback?: number
  autoRebalance?: number
}

/** One PVE replication job (pvesr), as much of it as can be recreated. */
export type ReplicationJobCapture = {
  id: string
  guest: number
  target: string
  schedule?: string
  rate?: number
  comment?: string
  disable?: number
}

/**
 * Everything removed from the source guest to unblock the migration, in a
 * shape that survives a JSON round-trip through the migrate request body and
 * into the detached server-side watcher.
 */
export type CcmPrereqCapture = {
  ha: HaResourceCapture | null
  replication: ReplicationJobCapture[]
  /** Names of snapshots deleted. Informational only, they cannot come back. */
  snapshotsDeleted: string[]
}

/** What the caller wants replayed once the migration lands. */
export type CcmRestorePlan = {
  /** Config captured on the source before removal. */
  capture: CcmPrereqCapture
  /** Recreate the HA resource on the target cluster. */
  restoreHa: boolean
  /** HA state to request on the target; defaults to the captured state. */
  haState?: string
  /**
   * Recreate a replication job on the target cluster. Only meaningful when the
   * target storage replicates (zfspool / btrfs) and the cluster has a second
   * node, both checked by the caller.
   */
  restoreReplication: boolean
  /** Node of the target cluster to replicate to. */
  replicationTarget?: string
  /** systemd calendar schedule for the recreated job. PVE defaults to every 15 min. */
  replicationSchedule?: string
  /** Rate limit in MB/s for the recreated job. */
  replicationRate?: number
}

export const REPLICATION_CAPABLE_STORAGE_TYPES = ['zfspool', 'btrfs'] as const

/**
 * PVE only replicates guests whose volumes sit on a storage that can snapshot
 * locally per dataset. Offering "recreate replication" for anything else just
 * produces a job that fails on its first run.
 */
export function storageSupportsReplication(type?: string): boolean {
  if (!type) return false

  return (REPLICATION_CAPABLE_STORAGE_TYPES as readonly string[]).includes(type)
}
