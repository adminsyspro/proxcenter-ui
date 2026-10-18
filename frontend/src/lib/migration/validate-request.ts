/**
 * Validation of a migration request, shared by POST /api/v1/migrations (one
 * VM) and POST /api/v1/migrations/batches (one call per VM of the batch,
 * roadmap#53): a queued job of a batch must have passed exactly the checks a
 * job started on its own passes, for the user who created the batch.
 *
 * Returns the config persisted on the job (`migration_jobs.config`), which is
 * everything lib/migration/start-job needs to run it later, or the response
 * to send back.
 */
import { NextResponse } from "next/server"

import { assertStorageName } from "@/lib/ssh/validate"
import { sanitizeV2vRoot } from "@/lib/migration/v2v-root-select"
import { persistedV2vInputs } from "@/lib/migration/retry-dispatch"
import { parseNfcConcurrency, NFC_CONCURRENCY_MIN, NFC_CONCURRENCY_MAX } from "@/lib/migration/nfc-progress"
import { MIGRATION_CPU_TYPES, resolveMigrationCpuType } from "@/lib/migration/cpu-type"
import { parseHardwareOverrides, parseNicMappings, isAcceptableCpuType } from "@/lib/migration/target-overrides"
import { parseZeroRateLimit, ZERO_RATE_LIMIT_MIN_MBPS, ZERO_RATE_LIMIT_MAX_MBPS } from "@/lib/migration/warm/zero-rate"
import { hasServerFeature } from "@/lib/auth/requireEnterprise"
import { Features } from "@/lib/license/features"
import { isValidCopyAddress } from "@/lib/migration/warm/nfc-reachability"
import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"
import { authorizeMigrationTarget } from "@/lib/migration/authorize"
import { isValidSourceVmId } from "@/lib/migration/source-vm-id"

/** The tenant-scoped client of the request (getSessionPrisma). */
interface ValidationPrisma {
  connection: { findUnique: (args: any) => Promise<any> }
  migrationJob: { findFirst: (args: any) => Promise<any> }
}

export interface ValidatedMigration {
  /** Persisted as `migration_jobs.config`. */
  config: Record<string, unknown>
  sourceConnectionId: string
  sourceVmId: string
  sourceVmName: string | null
  sourceHost: string
  targetConnectionId: string
  targetNode: string
  targetStorage: string
  /** Source type and sub-type of the connection, for the dispatch. */
  sourceConn: { type: string; subType: string | null }
}

export type ValidationResult = { ok: true; value: ValidatedMigration } | { ok: false; response: Response }

const bad = (error: string, status = 400): ValidationResult =>
  ({ ok: false, response: NextResponse.json({ error }, { status }) })

const isSet = (v: unknown) => v !== undefined && v !== null && v !== ""

export async function validateMigrationRequest(
  body: Record<string, any>,
  ctx: { prisma: ValidationPrisma; tenantId: string },
): Promise<ValidationResult> {
  const { prisma, tenantId } = ctx
  const {
    sourceConnectionId,
    sourceVmId,
    targetConnectionId,
    targetNode,
    targetStorage,
    networkBridge = "vmbr0",
    migrationType = "cold",
    transferMode = "auto",
    targetVmid: targetVmidRaw,
  } = body

  // Boolean options arrive as real booleans from our UI but as strings from
  // raw API callers. Defaulting only `undefined` let the string "false"
  // through truthy — a caller that never asked for it got their VM started.
  // Coerce strictly: anything but true/"true" is false.
  const startAfterMigration = body.startAfterMigration === true || body.startAfterMigration === "true"
  const convertDisksToQcow2 = body.convertDisksToQcow2 === true || body.convertDisksToQcow2 === "true"

  if (!sourceConnectionId || !sourceVmId || !targetConnectionId || !targetNode || !targetStorage) {
    return bad("Missing required fields")
  }

  // The id reaches SOAP and XAPI requests as text: only an id's own grammar passes.
  if (!isValidSourceVmId(sourceVmId)) return bad("Invalid sourceVmId")

  // targetStorage is interpolated into the `qm disk import ... ${targetStorage}`
  // shell command run on the target node by the migration pipelines, so
  // constrain it to the PVE storage-id grammar here (command injection).
  try {
    assertStorageName(targetStorage)
  } catch {
    return bad("Invalid targetStorage")
  }

  // Optional caller-supplied target VMID. When omitted, the pipeline falls
  // back to `/cluster/nextid`. When set, validate the range here so we
  // reject bad input early; final availability is also re-checked by PVE
  // at create time, so we don't pre-check here (the value may have been
  // taken between this request and the actual allocation step).
  let targetVmid: number | undefined
  if (isSet(targetVmidRaw)) {
    const n = Number(targetVmidRaw)
    if (!Number.isInteger(n) || n < 100 || n > 999999999) {
      return bad("targetVmid must be an integer between 100 and 999999999")
    }
    targetVmid = n
  }

  // Optional 802.1Q VLAN tag (1-4094). Coerce string→number for clients that
  // serialise the form input as a string. Reject anything outside the valid
  // range here so misconfigured payloads don't reach the pipeline; undefined
  // means "no tag" (access port on the bridge's native VLAN).
  let vlanTag: number | undefined
  if (isSet(body.vlanTag)) {
    const n = typeof body.vlanTag === "number" ? body.vlanTag : Number.parseInt(String(body.vlanTag), 10)
    if (!Number.isInteger(n) || n < 1 || n > 4094) {
      return bad("vlanTag must be an integer between 1 and 4094")
    }
    vlanTag = n
  }

  // CPU type of the created VM (roadmap#24). Absent means the Proxmox default.
  // The review step (#317) offers the node's own models next to the quick
  // list, so any QEMU model Proxmox knows, or a cluster `custom-<name>`
  // model, is accepted; anything else is refused here, since the value ends
  // up in `qm create` on the node.
  const cpuType = resolveMigrationCpuType(body.cpuType) ?? (isAcceptableCpuType(body.cpuType) ? body.cpuType as string : null)
  if (cpuType === null) {
    return bad(`cpuType must be a QEMU CPU model known to Proxmox (for example ${MIGRATION_CPU_TYPES.join(", ")}) or a custom-<name> model`)
  }

  // Review-step overrides (#317): hardware right-sizing and one bridge per
  // NIC. VMware sources only (the vmware/vcenter pipelines apply them); on
  // any other source they are refused rather than silently ignored, so an
  // API caller is never led to believe they were applied.
  const hardwareParsed = parseHardwareOverrides(body.hardware)
  if (hardwareParsed.ok === false) return bad(hardwareParsed.error)
  const hardware = hardwareParsed.value
  const nicsParsed = parseNicMappings(body.nics)
  if (nicsParsed.ok === false) return bad(nicsParsed.error)
  const nics = nicsParsed.value

  const unauthorized = await authorizeMigrationTarget({
    tenantId, sourceConnectionId, targetConnectionId, targetNode, targetVmid, networkBridge, vlanTag, nics,
    copyVmk: typeof body.copyVmk === "string" && body.copyVmk !== "" ? body.copyVmk : undefined,
  })
  if (unauthorized) return { ok: false, response: unauthorized }

  // Optional warm-migration cutover downtime budget (seconds). Validate up
  // front: a malformed value would coerce to NaN and make the convergence
  // loop never auto-cut-over (it would run every pass then stall at the
  // operator gate). undefined means "use the pipeline default".
  let downtimeBudgetSec: number | undefined
  if (isSet(body.downtimeBudgetSec)) {
    const n = Number(body.downtimeBudgetSec)
    if (!Number.isFinite(n) || n < 30 || n > 86400) {
      return bad("downtimeBudgetSec must be a number between 30 and 86400 seconds")
    }
    downtimeBudgetSec = n
  }

  // Warm only (roadmap#45): cap on the thick-target zeroing write rate, MB/s,
  // 0 = unlimited. Absent means the cap of the target PVE connection,
  // resolved by the engine at run time. Rejected rather than defaulted on a
  // bad value: a silent "unlimited" is what the operator is trying to avoid.
  const parsedZeroRate = parseZeroRateLimit(body.zeroRateLimitMBps)
  if (parsedZeroRate === null) {
    return bad(`zeroRateLimitMBps must be 0 (unlimited) or an integer between ${ZERO_RATE_LIMIT_MIN_MBPS} and ${ZERO_RATE_LIMIT_MAX_MBPS} MB/s`)
  }
  // Enterprise setting: without the migration feature the value is dropped.
  // With it, the engine still only lets it tighten the target cluster's cap.
  const zeroRateLimitMBps = parsedZeroRate !== undefined && await hasServerFeature(Features.VMWARE_MIGRATION) ? parsedZeroRate : undefined

  // Warm only (roadmap#53): the VMkernel adapter of the source host the NFC
  // copy must use, as "vmkN" plus its address. Both or neither: the engine
  // needs the device to tag it on a vCenter host and the address to connect
  // and to probe reachability. The address reaches a shell probe on the node
  // and the device a SOAP call, so both grammars are checked here.
  let copyVmk: string | undefined
  let copyAddress: string | undefined
  if (isSet(body.copyVmk) || isSet(body.copyAddress)) {
    if (typeof body.copyVmk !== "string" || !/^vmk\d{1,3}$/.test(body.copyVmk) || !isValidCopyAddress(body.copyAddress)) {
      return bad('copyVmk must be a VMkernel device ("vmk0") and copyAddress its IP address or host name')
    }
    copyVmk = body.copyVmk
    copyAddress = body.copyAddress
  }

  // Who owns the warm switchover. "manual" holds the run in delta_sync,
  // replicating, until the operator triggers the cutover (#443). Rejected
  // rather than defaulted on a typo: silently falling back to "auto" would
  // cut a production VM over in the middle of the day.
  let cutoverMode: "auto" | "manual" | undefined
  if (isSet(body.cutoverMode)) {
    if (body.cutoverMode !== "auto" && body.cutoverMode !== "manual") {
      return bad('cutoverMode must be "auto" or "manual"')
    }
    cutoverMode = body.cutoverMode
  }

  // Optional virt-v2v root filesystem (`--root`). Only used by the cold
  // virt-v2v pipelines, and only needed for a genuine multi-boot guest: the
  // pipeline resolves the common SLES/openSUSE snapper case on its own.
  // Validated here so a typo comes back as a 400 instead of failing the job
  // hours later, and because the value reaches an SSH command line.
  let v2vRoot: string | undefined
  if (body.v2vRoot !== undefined && body.v2vRoot !== null && String(body.v2vRoot).trim() !== "") {
    const cleaned = sanitizeV2vRoot(String(body.v2vRoot))
    if (!cleaned) {
      return bad("v2vRoot must be a device or subvolume name as printed by virt-v2v, for example /dev/system/root")
    }
    v2vRoot = cleaned
  }

  // Parallel NFC disk downloads for the cold vCenter path (#807): the
  // dialog's slider, 1 to 8. Validated strictly so a bad value from a raw
  // API caller is a 400 rather than a silent fallback to the default.
  let nfcConcurrency: number | undefined
  if (body.nfcConcurrency !== undefined && body.nfcConcurrency !== null) {
    const parsed = parseNfcConcurrency(body.nfcConcurrency)
    if (parsed === null) {
      return bad(`nfcConcurrency must be an integer between ${NFC_CONCURRENCY_MIN} and ${NFC_CONCURRENCY_MAX}`)
    }
    nfcConcurrency = parsed
  }

  // Verify connections exist
  const [sourceConn, pveConn] = await Promise.all([
    prisma.connection.findUnique({ where: { id: sourceConnectionId }, select: { id: true, type: true, subType: true, name: true, baseUrl: true } }),
    prisma.connection.findUnique({ where: { id: targetConnectionId }, select: { id: true, type: true, name: true } }),
  ])

  const validSourceTypes = ["vmware", "xcpng", "hyperv", "nutanix"]
  if (!sourceConn || !validSourceTypes.includes(sourceConn.type)) {
    return bad("Source hypervisor connection not found (must be vmware, xcpng, hyperv, or nutanix)", 404)
  }
  if (!pveConn || pveConn.type !== "pve") {
    return bad("Proxmox connection not found", 404)
  }

  // Detect effective source type: vmware with subType "vcenter" routes to v2v pipeline
  let effectiveSourceType: string = sourceConn.type
  if (sourceConn.type === "vmware" && sourceConn.subType === "vcenter") {
    effectiveSourceType = "vcenter"
  }
  if ((hardware || nics) && effectiveSourceType !== "vmware" && effectiveSourceType !== "vcenter") {
    return bad("hardware and nics overrides are only supported for VMware sources (ESXi and vCenter)")
  }

  // Warm migration (CBT) is available for VMware sources (ESXi-direct and
  // vCenter) and for XCP-ng pools reached directly over XAPI (Xen Orchestra
  // exposes no CBT/NBD surface, so an "xo" connection stays offline-only).
  // Other hypervisors keep their existing paths; reject early with a clear
  // message rather than silently falling through to a cold/lossy path.
  const sourceSubType = sourceConn.subType ?? (sourceConn.type === "xcpng" ? "xo" : null)
  // The XCP-ng "Live" mode (snapshot + full download while the VM runs) was removed:
  // it never worked against Xen Orchestra and warm migration supersedes it.
  if (migrationType === "live" && effectiveSourceType === "xcpng") {
    return bad("Live migration is no longer available for XCP-ng; use Offline or Warm.")
  }
  const warmAllowed = effectiveSourceType === "vmware" || effectiveSourceType === "vcenter" || (effectiveSourceType === "xcpng" && sourceSubType === "xapi")
  if (migrationType === "warm" && !warmAllowed) {
    return bad(effectiveSourceType === "xcpng"
      ? "Warm migration needs a direct XCP-ng pool connection; this connection goes through Xen Orchestra, which only supports offline migration."
      : "Warm migration is only available for VMware and XCP-ng sources.")
  }

  // One migration per source VM at a time (roadmap#23). The warm engine already
  // refuses a second run through its in-memory lock, but only after the job row
  // exists, so a client that posts twice (the bulk dispatcher did, on a slow
  // POST) leaves a failed phantom job behind and may follow it instead of the
  // real one. Refuse here, before any row is written, for every pipeline. A
  // job queued in a batch counts: it will run.
  const inFlight = await prisma.migrationJob.findFirst({
    where: { sourceConnectionId, sourceVmId, status: { notIn: TERMINAL_STATUSES as unknown as string[] } },
    select: { id: true, status: true },
    orderBy: { startedAt: "desc" },
  })
  if (inFlight) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `A migration of this source VM is already in progress (job ${inFlight.id}, ${inFlight.status}). Wait for it to finish or cancel it before starting another.`,
          jobId: inFlight.id,
        },
        { status: 409 },
      ),
    }
  }

  return {
    ok: true,
    value: {
      sourceConnectionId, sourceVmId, sourceVmName: body.sourceVmName || null, sourceHost: sourceConn.baseUrl,
      targetConnectionId, targetNode, targetStorage,
      sourceConn: { type: sourceConn.type, subType: sourceConn.subType ?? null },
      // targetVmid stored in config so the pipeline can read it back; the
      // top-level `targetVmid` Prisma column gets set by the pipeline once
      // the actual VM is created (next-free fallback path).
      // Warm-only options (vddkLibdir, downtimeBudgetSec) are persisted here so a
      // retry — which rebuilds the config from job.config — keeps them instead of
      // silently reverting to the defaults.
      config: { sourceConnectionId, sourceVmId, sourceVmName: body.sourceVmName, targetConnectionId, targetNode, targetStorage, networkBridge, vlanTag, startAfterMigration, convertDisksToQcow2, cpuType, migrationType, transferMode, ...(targetVmid !== undefined && { targetVmid }), ...(body.vddkLibdir && { vddkLibdir: body.vddkLibdir }), ...(downtimeBudgetSec !== undefined && { downtimeBudgetSec }), ...(cutoverMode !== undefined && { cutoverMode }), ...(zeroRateLimitMBps !== undefined && { zeroRateLimitMBps }), ...(copyVmk && { copyVmk, copyAddress }),
        // Review-step overrides (#317), persisted so a retry keeps the same
        // hardware and NIC layout.
        ...(hardware && { hardware }), ...(nics && { nics }),
        // Source type and virt-v2v inputs (disk paths, vCenter placement, temp
        // storage, root override): persisted so a retry rebuilds the same job.
        sourceType: effectiveSourceType,
        ...persistedV2vInputs(body, v2vRoot, nfcConcurrency) },
    },
  }
}
