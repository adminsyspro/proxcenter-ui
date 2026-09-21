/**
 * CPU type applied to the VM a migration creates (roadmap#24).
 *
 * Every pipeline used to decide on its own: the ESXi-direct, warm and XCP-ng
 * mappers hardcoded `host`, virt-v2v hardcoded `x86-64-v2-AES`. The default is
 * now the Proxmox GUI default everywhere, and the operator can pick another
 * model in the migration dialog. `host` stays offered for the workloads that
 * want the node's full instruction set and accept the hardware coupling it
 * brings (no live migration to a node with a different CPU).
 */
export const MIGRATION_CPU_TYPES = ["x86-64-v2-AES", "x86-64-v3", "x86-64-v4", "host", "kvm64"] as const
export type MigrationCpuType = (typeof MIGRATION_CPU_TYPES)[number]
export const MIGRATION_CPU_TYPE_DEFAULT: MigrationCpuType = "x86-64-v2-AES"

/**
 * Resolve the `cpuType` a caller sent: the default when absent, the value when
 * it is one of the offered models, null otherwise so the route answers 400
 * instead of handing an arbitrary string to `qm create`.
 */
export function resolveMigrationCpuType(value: unknown): MigrationCpuType | null {
  if (value === undefined || value === null || value === "") return MIGRATION_CPU_TYPE_DEFAULT
  return typeof value === "string" && (MIGRATION_CPU_TYPES as readonly string[]).includes(value)
    ? (value as MigrationCpuType)
    : null
}
