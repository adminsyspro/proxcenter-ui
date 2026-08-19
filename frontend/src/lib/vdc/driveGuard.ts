// src/lib/vdc/driveGuard.ts
// Shared enforcement for every route that writes tenant disk config to PVE
// (config PUT, guest create). Spec §5.3: verdicts run on the UNION scope,
// iaas tenants only; provider and MSP flows are untouched.
//
// Also hosts the post-write storage-tier QoS restamp (`restampGuestDrives`),
// shared by clone/restore/snapshot-rollback so the after() GET-patch-PUT
// loop isn't triplicated across routes, and the import-from metering helper
// (`meterImportRefs`) shared by the config PUT and guest create routes.

import { pveFetch } from '@/lib/proxmox/client'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { safeLog } from '@/lib/log/sanitize'

import {
  DATA_DISK_KEY_RE, isTenantDiskKey, stampDriveQos, validateDriveAgainstScope, parseDriveString,
  type DriveQosCaps,
} from './drives'

export class DriveScopeError extends Error {}

/** A validated drive carrying an import-from option (spec Finding I2): PVE
 *  allocates the SOURCE volume's full size regardless of the declared
 *  size, so every such drive must be re-metered against the REAL source
 *  size, not just the ones declaring 0/no size. `declaredMb` is whatever
 *  the main enforceTenantDrives loop already counted for this drive (0 when
 *  newAllocationGb is null/0); meterImportRefs only adds the DELTA on top,
 *  it never re-counts the declared part. */
export interface ImportRef {
  key: string
  targetStorage: string
  sourceVolid: string
  declaredMb: number
}

export interface DriveEnforcement {
  addStorageMbByStorage: Record<string, number>
  totalAddMb: number
  importRefs: ImportRef[]
}

export async function enforceTenantDrives(args: {
  tenantId: string
  connectionId: string
  type: 'qemu' | 'lxc'
  body: Record<string, any>
}): Promise<DriveEnforcement | null> {
  const infra = await getTenantInfrastructureScope(args.tenantId, { ignoreVdcContext: true })
  if (infra.kind !== 'iaas') return null
  const scope = infra.vdcScope
  if (!scope) throw new DriveScopeError('Tenant vDC scope not resolved')

  const allowedStorages = scope.storagesByConnection.get(args.connectionId) ?? new Set<string>()
  const policies = scope.storagePoliciesByConnection.get(args.connectionId) ?? new Map()

  const addStorageMbByStorage: Record<string, number> = {}
  let totalAddMb = 0
  const importRefs: ImportRef[] = []

  for (const key of Object.keys(args.body)) {
    if (!isTenantDiskKey(key, args.type)) continue
    const raw = String(args.body[key] ?? '')
    const verdict = validateDriveAgainstScope(key, raw, allowedStorages)
    if (verdict.ok === false) throw new DriveScopeError(verdict.error)
    const { drive } = verdict

    // Stamping is deliberately NOT exempted for cdrom lines: a tenant could
    // spoof media=cdrom on a data disk key to dodge the QoS caps, and
    // stampDriveQos itself already strips-and-stamps cdrom lines too.
    if (args.type === 'qemu' && DATA_DISK_KEY_RE.test(key) && drive.storage) {
      args.body[key] = stampDriveQos(raw, policies.get(drive.storage))
    }
    let declaredMb = 0
    if (drive.storage && drive.newAllocationGb !== null && drive.newAllocationGb > 0) {
      declaredMb = Math.round(drive.newAllocationGb * 1024)
      addStorageMbByStorage[drive.storage] = (addStorageMbByStorage[drive.storage] ?? 0) + declaredMb
      totalAddMb += declaredMb
    }
    if (drive.storage) {
      // A declared size next to import-from is only a LOWER bound: PVE
      // still allocates the source volume's full size regardless of what
      // the tenant typed (`gold:1,import-from=...` costs as much as
      // `gold:0,import-from=...`). Capture the ref for EVERY import-from
      // drive, not only the 0/absent-size shape (refuse-nothing: import is
      // a legitimate CreateVmDialog flow): hand the caller the reference,
      // declared amount included, so it can meter the REAL source size.
      const importOpt = drive.opts.find(([k]) => k === 'import-from')
      if (importOpt) {
        importRefs.push({ key, targetStorage: drive.storage, sourceVolid: importOpt[1], declaredMb })
      }
    }
  }
  return { addStorageMbByStorage, totalAddMb, importRefs }
}

/** Resolve the real size (MB) of each import-from source volume and return
 *  an ADDITIONAL addStorageMbByStorage/totalAddMb pair to fold on top of
 *  the caller's existing metering (spec Finding I2: meter, never refuse).
 *  Each ref's `declaredMb` was already counted by enforceTenantDrives's main
 *  loop, so this only adds `max(0, sourceMb - declaredMb)`: the part PVE
 *  allocates beyond what the tenant declared, never the full source size
 *  again (that would double-count the declared portion). One storage
 *  content listing per DISTINCT source storage: a tenant importing several
 *  disks from the same source storage doesn't cost several PVE round-trips.
 *  Fail-open per ref (absent volid, listing throws, unexpected shape):
 *  logged and skipped, the declared metering the caller already has
 *  stands unchanged, never blocks the request, same class as the rest of
 *  the lot's best-effort metering (e.g. getVdcStorageUsedMb in quota.ts). */
export async function meterImportRefs(
  conn: any,
  node: string,
  importRefs: ImportRef[],
): Promise<{ addStorageMbByStorage: Record<string, number>; totalAddMb: number }> {
  const addStorageMbByStorage: Record<string, number> = {}
  let totalAddMb = 0
  const contentByStorage = new Map<string, any[] | null>()

  for (const ref of importRefs) {
    const srcStorage = ref.sourceVolid.split(':', 2)[0] ?? ''
    if (!srcStorage) continue

    if (!contentByStorage.has(srcStorage)) {
      try {
        const content = await pveFetch<any[]>(
          conn,
          `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(srcStorage)}/content`,
        )
        if (!Array.isArray(content)) {
          console.warn(`[import-meter] unexpected content listing shape for "${safeLog(srcStorage)}" on "${safeLog(node)}"`)
          contentByStorage.set(srcStorage, null)
        } else {
          contentByStorage.set(srcStorage, content)
        }
      } catch (err: any) {
        console.warn(`[import-meter] content listing failed for "${safeLog(srcStorage)}" on "${safeLog(node)}": ${safeLog(err?.message ?? err)}`)
        contentByStorage.set(srcStorage, null)
      }
    }

    const content = contentByStorage.get(srcStorage)
    if (!content) continue

    const vol = content.find((v: any) => v?.volid === ref.sourceVolid)
    if (!vol) {
      console.warn(`[import-meter] source volid "${safeLog(ref.sourceVolid)}" not found on storage "${safeLog(srcStorage)}"`)
      continue
    }

    const bytes = Number(vol.size) || 0
    if (bytes <= 0) continue
    const sourceMb = Math.round(bytes / 1048576)
    const additionalMb = Math.max(0, sourceMb - ref.declaredMb)
    if (additionalMb <= 0) continue
    addStorageMbByStorage[ref.targetStorage] = (addStorageMbByStorage[ref.targetStorage] ?? 0) + additionalMb
    totalAddMb += additionalMb
  }

  return { addStorageMbByStorage, totalAddMb }
}

/** Post-write storage-tier QoS restamp: GET the guest config, re-stamp every
 *  DATA disk whose storage carries a tier policy, PUT only if something
 *  actually changed. Shared by the clone/restore/snapshot-rollback after()
 *  blocks (spec §5.3 + Finding I1): each schedules its own waitForTask on
 *  the write's UPID, then calls this once the task has settled. Never
 *  throws: a failure here must not surface as a failed clone/restore/
 *  rollback, it only logs. `logTag` should already carry the guest
 *  identifier (e.g. `` `[clone-qos-stamp] vmid=${newid}` ``) so a failure
 *  can be traced back to the guest it happened for; the caller's own
 *  interpolations into it must already be safeLog'd (raw path/body
 *  segments can carry log-injection-prone characters). */
export async function restampGuestDrives(args: {
  conn: any
  configPath: string
  policies: Map<string, DriveQosCaps>
  logTag: string
}): Promise<void> {
  const { conn, configPath, policies, logTag } = args
  try {
    const cfg = await pveFetch<any>(conn, configPath)
    const patch = new URLSearchParams()
    for (const [k, v] of Object.entries(cfg || {})) {
      if (!DATA_DISK_KEY_RE.test(k)) continue
      const parsed = parseDriveString(String(v ?? ''))
      if (parsed.ok === false || parsed.drive.storage === null) continue
      const caps = policies.get(parsed.drive.storage)
      if (!caps) continue
      const stamped = stampDriveQos(String(v), caps)
      if (stamped !== String(v)) patch.set(k, stamped)
    }
    if (Array.from(patch.keys()).length > 0) {
      await pveFetch<any>(conn, configPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: patch.toString(),
      })
    }
  } catch (err: any) {
    console.error(`${logTag} failed: ${safeLog(err?.message ?? err)}`)
  }
}
