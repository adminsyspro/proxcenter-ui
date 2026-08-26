export type WarmStatus =
  | "pending" | "planning" | "enabling_cbt" | "preparing_disks" | "full_copy" | "delta_sync"
  | "awaiting_cutover" | "cutover" | "verify" | "converting_disks"
  | "completed" | "failed" | "cancelled"

export interface WarmMigrationConfig {
  sourceConnectionId: string
  sourceVmId: string
  targetConnectionId: string
  targetNode: string
  targetStorage: string
  networkBridge: string
  vlanTag?: number
  startAfterMigration: boolean
  /**
   * Convert the migrated data disks to qcow2 after the cutover (one `move_disk`
   * per disk on the same storage), so they can take Proxmox snapshots on a
   * snapshot-as-volume-chain LVM storage (#595). Opt-in, default false; the
   * conversion can never fail the migration.
   */
  convertDisksToQcow2?: boolean
  targetVmid?: number
  /** Extracted VDDK distribution dir on the PVE node (libdir=). */
  vddkLibdir?: string
  /** Max cutover downtime before warm requires operator consent (default 300s). */
  downtimeBudgetSec?: number
  /** Safety cap on delta passes (default 5). */
  maxPasses?: number
  /**
   * Who decides the switchover (default "auto"). "manual" keeps replicating and
   * waits for the operator's cutover instead of ever deciding on its own, which
   * is what a migration scheduled inside a maintenance window needs (#443).
   */
  cutoverMode?: "auto" | "manual"
}

export interface LogEntry { ts: string; msg: string; level: "info" | "success" | "warn" | "error" }
