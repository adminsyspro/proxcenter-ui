/**
 * Which engine a retried migration job goes back to.
 *
 * The create route (/api/v1/migrations) picks the engine from the source
 * connection type and the migration mode; the retry route used to send every
 * non-warm job to the direct-ESXi pipeline, which fails on anything else with
 * "ESXi connection not found" (Hyper-V, vCenter, Nutanix and offline XCP-ng
 * jobs could not be retried). The engine is now derived from the sourceType
 * persisted in the job config, with the live connection as a fallback for
 * jobs created before that field existed.
 */

import type { V2vMigrationConfig } from "./v2v-pipeline"

export type RetryEngine = "warm-vmware" | "warm-xcpng" | "v2v" | "xcpng-cold" | "vmware"

export interface RetrySourceConnection {
  type: string
  subType?: string | null
}

/** Effective source type, same rule as the create route (vmware + vcenter subType => vcenter). */
export function resolveRetrySourceType(
  config: Record<string, any> | null | undefined,
  sourceConn: RetrySourceConnection | null | undefined,
): string {
  const persisted = typeof config?.sourceType === "string" ? config.sourceType : null
  if (persisted) return persisted
  if (!sourceConn) return "vmware"
  if (sourceConn.type === "vmware" && sourceConn.subType === "vcenter") return "vcenter"
  return sourceConn.type
}

export function resolveRetryEngine(
  config: Record<string, any> | null | undefined,
  sourceConn: RetrySourceConnection | null | undefined,
): RetryEngine {
  const sourceType = resolveRetrySourceType(config, sourceConn)
  const isWarm = config?.migrationType === "warm"

  if (isWarm) return sourceType === "xcpng" ? "warm-xcpng" : "warm-vmware"
  if (sourceType === "vcenter" || sourceType === "hyperv" || sourceType === "nutanix") return "v2v"
  if (sourceType === "xcpng") return "xcpng-cold"
  return "vmware"
}

/**
 * Rebuild the virt-v2v pipeline config from a persisted job config. Mirrors
 * the object the create route hands to runV2vMigrationPipeline.
 */
export function v2vConfigFromJobConfig(
  config: Record<string, any>,
  job: { sourceConnectionId: string; sourceVmId: string; sourceVmName: string | null; targetConnectionId: string; targetNode: string; targetStorage: string },
  sourceConn: RetrySourceConnection | null | undefined = null,
): V2vMigrationConfig {
  // Same resolution as the engine choice: a job saved before sourceType was
  // persisted must not fall back to "vmware" here while the engine was picked
  // from the live connection.
  const sourceType = resolveRetrySourceType(config, sourceConn) as V2vMigrationConfig["sourceType"]
  const migrationType: "cold" | "live" = sourceType === "vcenter" && config.migrationType === "live" ? "live" : "cold"

  return {
    sourceConnectionId: config.sourceConnectionId || job.sourceConnectionId,
    sourceVmId: config.sourceVmId || job.sourceVmId,
    sourceVmName: config.sourceVmName || job.sourceVmName || "",
    sourceType,
    targetConnectionId: config.targetConnectionId || job.targetConnectionId,
    targetNode: config.targetNode || job.targetNode,
    targetStorage: config.targetStorage || job.targetStorage,
    networkBridge: config.networkBridge || "",
    vlanTag: config.vlanTag,
    startAfterMigration: !!config.startAfterMigration,
    convertDisksToQcow2: !!config.convertDisksToQcow2,
    vcenterDatacenter: config.vcenterDatacenter,
    vcenterCluster: config.vcenterCluster,
    vcenterHost: config.vcenterHost,
    diskPaths: Array.isArray(config.diskPaths) ? config.diskPaths : undefined,
    tempStorage: config.tempStorage,
    migrationType,
    ...(config.targetVmid !== undefined && { targetVmid: config.targetVmid }),
    ...(config.v2vRoot !== undefined && { v2vRoot: config.v2vRoot }),
  }
}

/**
 * virt-v2v inputs the migration dialog sends (Hyper-V / Nutanix disk paths,
 * vCenter placement, temporary storage, root override). Persisted in
 * `job.config` so a retry rebuilds the same job instead of falling back to the
 * ESXi defaults. Empty values are dropped so the stored config stays small.
 */
export function persistedV2vInputs(body: Record<string, any>, v2vRoot: string | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (Array.isArray(body.diskPaths) && body.diskPaths.length > 0) out.diskPaths = body.diskPaths
  if (body.tempStorage) out.tempStorage = body.tempStorage
  if (body.vcenterDatacenter) out.vcenterDatacenter = body.vcenterDatacenter
  if (body.vcenterCluster) out.vcenterCluster = body.vcenterCluster
  if (body.vcenterHost) out.vcenterHost = body.vcenterHost
  if (v2vRoot !== undefined) out.v2vRoot = v2vRoot
  return out
}
