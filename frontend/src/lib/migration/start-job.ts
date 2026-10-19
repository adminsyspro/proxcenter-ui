/**
 * Start a migration job that already exists as a row (roadmap#53).
 *
 * One dispatch for the three ways a job starts: the creation route, the retry
 * route and the batch scheduler, which starts the queued jobs of a bulk
 * migration long after the request that created them is gone. Everything is
 * read back from the job row, whose `config` holds the validated request
 * (see /api/v1/migrations/route.ts), so a queued job needs nothing but its row.
 *
 * Resolves when the pipeline returns, i.e. when the job is terminal or its
 * pipeline gave up; the pipelines record their own failures on the row.
 */

import { getTenantPrisma } from "@/lib/tenant"
import { runMigrationPipeline } from "@/lib/migration/pipeline"
import { runXcpngMigrationPipeline } from "@/lib/migration/xcpng-pipeline"
import { runV2vMigrationPipeline } from "@/lib/migration/v2v-pipeline"
import { runWarmMigration } from "@/lib/migration/warm/warm-pipeline"
import { runXcpngWarmMigration } from "@/lib/migration/warm/xcpng-warm-pipeline"
import type { WarmMigrationConfig } from "@/lib/migration/warm/types"
import { resolveRetryEngine, v2vConfigFromJobConfig, type RetrySourceConnection } from "@/lib/migration/retry-dispatch"
import { soapLogin, soapLogout, soapGetVmConfig, parseVmConfig } from "@/lib/vmware/soap"
import { decryptSecret } from "@/lib/crypto/secret"

export interface StartableJob {
  id: string
  sourceConnectionId: string
  sourceVmId: string
  sourceVmName: string | null
  targetConnectionId: string
  targetNode: string
  targetStorage: string
  config: unknown
}

type ColdConfig = Parameters<typeof runMigrationPipeline>[1]

/** The VMware/XCP-ng warm engine config, the fields the creation route validated and persisted. */
export function warmConfigFromJobConfig(c: Record<string, any>, engine: "warm-vmware" | "warm-xcpng"): WarmMigrationConfig {
  return {
    sourceConnectionId: c.sourceConnectionId, sourceVmId: c.sourceVmId, targetConnectionId: c.targetConnectionId,
    targetNode: c.targetNode, targetStorage: c.targetStorage,
    networkBridge: c.networkBridge, vlanTag: c.vlanTag, startAfterMigration: !!c.startAfterMigration,
    convertDisksToQcow2: !!c.convertDisksToQcow2, cpuType: c.cpuType,
    // Review-step overrides (#317) and the copy network (roadmap#53) are
    // applied by the VMware engine only; vddkLibdir has no meaning on XCP-ng.
    ...(engine === "warm-vmware" && c.hardware && { hardware: c.hardware }),
    ...(engine === "warm-vmware" && c.nics && { nics: c.nics }),
    ...(engine === "warm-vmware" && Array.isArray(c.disks) && c.disks.length > 0 && { disks: c.disks }),
    ...(c.targetVmid !== undefined && { targetVmid: c.targetVmid }),
    ...(engine === "warm-vmware" && c.vddkLibdir && { vddkLibdir: c.vddkLibdir }),
    ...(c.downtimeBudgetSec !== undefined && { downtimeBudgetSec: c.downtimeBudgetSec }),
    ...(c.cutoverMode !== undefined && { cutoverMode: c.cutoverMode }),
    ...(c.zeroRateLimitMBps !== undefined && { zeroRateLimitMBps: c.zeroRateLimitMBps }),
    ...(engine === "warm-vmware" && c.copyVmk && { copyVmk: c.copyVmk }),
    // Guest conversion at cutover (#1000): VMware engine only, the operator's
    // last choice when the job was cut over before (a retry replays it).
    ...(engine === "warm-vmware" && typeof c.convertGuest === "boolean" && { convertGuest: c.convertGuest }),
  }
}

/** The direct-ESXi and offline XCP-ng pipeline config. */
export function coldConfigFromJobConfig(c: Record<string, any>): ColdConfig {
  return {
    sourceConnectionId: c.sourceConnectionId, sourceVmId: c.sourceVmId, targetConnectionId: c.targetConnectionId,
    targetNode: c.targetNode, targetStorage: c.targetStorage,
    networkBridge: c.networkBridge, vlanTag: c.vlanTag, startAfterMigration: !!c.startAfterMigration,
    convertDisksToQcow2: !!c.convertDisksToQcow2, cpuType: c.cpuType,
    ...(c.hardware && { hardware: c.hardware }),
    ...(c.nics && { nics: c.nics }),
    ...(Array.isArray(c.disks) && c.disks.length > 0 && { disks: c.disks }),
    migrationType: c.migrationType as "cold" | "live" | "sshfs_boot",
    transferMode: c.transferMode as "https" | "sshfs",
    // The user-selected Temporary Storage keeps SSHFS mounts, VMDK dumps and
    // clone targets of the direct-ESXi pipeline off /tmp.
    ...(c.tempStorage && { tempStorage: c.tempStorage as string }),
    ...(c.targetVmid !== undefined && { targetVmid: c.targetVmid }),
  } as ColdConfig
}

/**
 * Direct-ESXi cold: a Windows guest goes through virt-v2v for its driver
 * injection, a Linux guest stays on the in-house pipeline, which boots on any
 * bus. Ground truth comes from SOAP (a hint from the browser could be stale);
 * returns the virt-v2v inputs, or null to stay on the in-house pipeline.
 */
async function resolveEsxiV2vRoute(sourceConnectionId: string, sourceVmId: string, tenantId: string): Promise<{ vmxPath: string; esxiHost: string } | null> {
  try {
    const authCreds = await getTenantPrisma(tenantId).connection.findUnique({
      where: { id: sourceConnectionId },
      select: { apiTokenEnc: true, baseUrl: true, insecureTLS: true, sshKeyEnc: true, sshPassEnc: true, sshEnabled: true },
    })
    if (!authCreds?.apiTokenEnc) return null
    const creds = decryptSecret(authCreds.apiTokenEnc)
    const colonIdx = creds.indexOf(":")
    const esxiUser = colonIdx > 0 ? creds.substring(0, colonIdx) : "root"
    const esxiPass = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
    const soap = await soapLogin(authCreds.baseUrl.replace(/\/$/, ""), esxiUser, esxiPass, authCreds.insecureTLS)
    let vmPathName = ""
    let esxiHostname = ""
    let routeToV2v = false
    try {
      const parsed = parseVmConfig(await soapGetVmConfig(soap, sourceVmId))
      vmPathName = parsed.vmPathName || ""
      try { esxiHostname = new URL(authCreds.baseUrl).hostname } catch { esxiHostname = "" }
      const isWindowsGuest = /win/i.test(parsed.guestOS) || /win/i.test(parsed.guestId)
      // virt-v2v -i vmx -it ssh needs SSH auth on the ESXi source. The v2v
      // pipeline reuses the stored key when present, or bootstraps a one-shot
      // key via sshpass when only a password is configured, so `sshEnabled`
      // plus *some* credential is enough here.
      const hasSshCredential = !!authCreds.sshKeyEnc || !!authCreds.sshPassEnc
      routeToV2v = isWindowsGuest && !!vmPathName && authCreds.sshEnabled && hasSshCredential
    } finally {
      await soapLogout(soap).catch(() => {})
    }
    if (!routeToV2v) return null
    // "[Datastore] folder/VmName.vmx" -> "/vmfs/volumes/Datastore/folder/VmName.vmx"
    const vmxMatch = /^\[([^\]]+)\]\s+(\S.*)$/.exec(vmPathName)
    const datastore = vmxMatch?.[1] || ""
    const relPath = vmxMatch?.[2] || ""
    if (!datastore || !relPath || !esxiHostname) return null
    return { vmxPath: `/vmfs/volumes/${datastore}/${relPath}`, esxiHost: esxiHostname }
  } catch {
    // The routing lookup failed: the in-house pipeline does its own SOAP login
    // and surfaces any real auth or connectivity problem.
    return null
  }
}

/**
 * Run the pipeline of `job`. `sourceConn` is the job's source connection when
 * the caller already has it; it only matters for a config saved before
 * `sourceType` was persisted, and is read here otherwise.
 */
export async function startMigrationJob(job: StartableJob, tenantId: string, sourceConn?: RetrySourceConnection | null): Promise<void> {
  const config = (job.config ?? {}) as Record<string, any>
  const conn = sourceConn !== undefined || typeof config.sourceType === "string"
    ? sourceConn
    : await getTenantPrisma(tenantId).connection.findUnique({ where: { id: job.sourceConnectionId }, select: { type: true, subType: true } })
  const engine = resolveRetryEngine(config, conn)

  // Warm is routed explicitly BEFORE any fall-through: a "warm" job must never
  // reach a cold, live or virt-v2v branch, which power off the running source.
  switch (engine) {
    case "warm-vmware":
    case "warm-xcpng": {
      const run = engine === "warm-vmware" ? runWarmMigration : runXcpngWarmMigration
      await run(job.id, warmConfigFromJobConfig(config, engine), tenantId)
      return
    }
    case "v2v":
      await runV2vMigrationPipeline(job.id, v2vConfigFromJobConfig(config, job, conn), tenantId)
      return
    case "xcpng-cold":
      await runXcpngMigrationPipeline(job.id, { ...coldConfigFromJobConfig(config), migrationType: "cold" }, tenantId)
      return
    default: {
      const cold = coldConfigFromJobConfig(config)
      const v2vRoute = config.migrationType === "cold"
        ? await resolveEsxiV2vRoute(job.sourceConnectionId, job.sourceVmId, tenantId)
        : null
      if (v2vRoute) {
        await runV2vMigrationPipeline(job.id, {
          sourceConnectionId: cold.sourceConnectionId, sourceVmId: cold.sourceVmId, sourceVmName: config.sourceVmName || job.sourceVmName || "",
          sourceType: "esxi-direct",
          targetConnectionId: cold.targetConnectionId, targetNode: cold.targetNode, targetStorage: cold.targetStorage,
          networkBridge: cold.networkBridge, vlanTag: cold.vlanTag, startAfterMigration: cold.startAfterMigration,
          convertDisksToQcow2: cold.convertDisksToQcow2, cpuType: cold.cpuType,
          ...(cold.hardware && { hardware: cold.hardware }), ...(cold.nics && { nics: cold.nics }), ...(cold.disks && { disks: cold.disks }),
          tempStorage: config.tempStorage,
          migrationType: "cold",
          vmxPath: v2vRoute.vmxPath,
          esxiHost: v2vRoute.esxiHost,
          ...(config.targetVmid !== undefined && { targetVmid: config.targetVmid }),
          ...(config.v2vRoot !== undefined && { v2vRoot: config.v2vRoot }),
        }, tenantId)
        return
      }
      await runMigrationPipeline(job.id, cold, tenantId)
    }
  }
}
