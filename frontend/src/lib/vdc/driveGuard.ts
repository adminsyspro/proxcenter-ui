// src/lib/vdc/driveGuard.ts
// Shared enforcement for every route that writes tenant disk config to PVE
// (config PUT, guest create). Spec §5.3: verdicts run on the UNION scope,
// iaas tenants only; provider and MSP flows are untouched.

import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'

import {
  DATA_DISK_KEY_RE, isTenantDiskKey, stampDriveQos, validateDriveAgainstScope,
} from './drives'

export class DriveScopeError extends Error {}

export interface DriveEnforcement {
  addStorageMbByStorage: Record<string, number>
  totalAddMb: number
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
    if (drive.storage && drive.newAllocationGb !== null && drive.newAllocationGb > 0) {
      const mb = Math.round(drive.newAllocationGb * 1024)
      addStorageMbByStorage[drive.storage] = (addStorageMbByStorage[drive.storage] ?? 0) + mb
      totalAddMb += mb
    }
  }
  return { addStorageMbByStorage, totalAddMb }
}
