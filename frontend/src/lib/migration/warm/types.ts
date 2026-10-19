import type { MigrationDiskMapping, MigrationHardwareOverrides, MigrationNicMapping } from "../target-overrides"

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
  /**
   * Convert the guest at cutover with virt-v2v-in-place (#1000): VirtIO drivers
   * in the initramfs or the Windows driver store, VMware Tools removed, then a
   * VirtIO SCSI boot disk and VirtIO NICs. Set at launch as the default; the
   * operator's choice in the "Cutover now" dialog overwrites it in the job's
   * config, which the engine reads back at cutover and a retry replays.
   * Absent means true. A conversion that fails or is not possible leaves the
   * copied volumes untouched and keeps the compatible hardware (SATA/e1000).
   */
  convertGuest?: boolean
  /**
   * CPU type of the created VM (roadmap#24). One of MIGRATION_CPU_TYPES, validated
   * by the route; absent means the Proxmox default, x86-64-v2-AES.
   */
  cpuType?: string
  /** Operator hardware overrides of the created VM (#317): cores, sockets, memory. */
  hardware?: MigrationHardwareOverrides
  /** Per-source-NIC target bridge, VLAN tag and model (#317); unmapped NICs use networkBridge. */
  nics?: MigrationNicMapping[]
  /** Per-source-disk target storage or exclusion (#317, lot 2); unmapped disks use targetStorage. */
  disks?: MigrationDiskMapping[]
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
  /**
   * Cap on the write rate of the thick-target zeroing, MB/s (roadmap#45). 0 is
   * unlimited; absent means the cap of the target PVE connection.
   */
  zeroRateLimitMBps?: number
  /**
   * VMkernel adapter of the source host the NFC copy must use (roadmap#53),
   * e.g. "vmk2", with its address. On a standalone ESXi source the VDDK
   * connects to that address directly; on a vCenter source the adapter is
   * tagged vSphereBackupNFC on the host so vSphere hands out NFC tickets on
   * it. Absent means the host's default: its vSphereBackupNFC-tagged adapter
   * when one exists, otherwise management.
   */
  copyVmk?: string
}

/**
 * The phases a warm job announces in its log (#1000): the dialogs render each
 * as a section header, so the operator sees where the migration stands.
 */
export type WarmLogStep = "planning" | "prepare" | "full_copy" | "delta" | "cutover" | "verify" | "conversion" | "finish"

export interface LogEntry {
  ts: string
  msg: string
  /** "step" marks the start of a phase; `step` then names it. */
  level: "info" | "success" | "warn" | "error" | "step"
  step?: WarmLogStep
}
