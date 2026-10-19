import { useEffect, useState } from 'react'

import { DOWNTIME_BUDGET_DEFAULT_SEC } from '../components/migrationGuards'
import { NFC_CONCURRENCY_DEFAULT } from '@/lib/migration/nfc-progress'
import { MIGRATION_CPU_TYPE_DEFAULT } from '@/lib/migration/cpu-type'
import { BULK_MIG_CONCURRENCY_DEFAULT } from '../bulkMigrationConfig'
import type { ReviewHardwareState, ReviewNicState } from '../components/migrationReview'

/**
 * Minimal shape of the VM the single-migration dialog was opened for. Only the
 * fields the reset logic needs; InventoryDetails' richer esxiMigrateVm state
 * is structurally assignable to it.
 */
type MigrationDialogVm = { hostType?: string; diskPaths?: string[]; diskMountPaths?: string[] } | null | undefined

/**
 * Hyper-V sources with known VHDX paths get migDiskPaths pre-filled with the
 * paths under the /mnt/hyperv/ mount the migration pipeline uses. The API
 * computes them relative to the SMB share's local folder (diskMountPaths, see
 * lib/hyperv/diskPaths.ts); older payloads without that field fall back to the
 * basename ("C:\VMs\TestVM.vhdx" -> "/mnt/hyperv/TestVM.vhdx"), which the
 * pipeline then relocates by file name. Every other source starts blank.
 * Derived here, inside the reset, because deriving it in the dialog-open click
 * handler would be wiped by the reset effect running right after (state
 * updates from the handler and the open both commit before the effect fires).
 */
export function deriveHypervDiskPaths(vm: MigrationDialogVm): string {
  if (!vm || vm.hostType !== 'hyperv' || !vm.diskPaths?.length) return ''

  const mountPaths = vm.diskMountPaths?.length === vm.diskPaths.length
    ? vm.diskMountPaths
    : vm.diskPaths.map(p => `/mnt/hyperv/${p.split('\\').pop() || p.split('/').pop() || p}`)

  return mountPaths.join('\n')
}

/**
 * Per-migration option state shared by the single-VM and the bulk migration
 * dialogs (components/InventoryDialogs.tsx).
 *
 * Every option resets to its default each time either dialog opens. The state
 * lives at page level (InventoryDetails) and used to survive from one
 * migration to the next in the same page session, so an option toggled for an
 * earlier VM silently applied to every later run — a live customer report in
 * #443: "start VM after migration" fired although it was never ticked for
 * that job. Keeping the whole family in this hook guarantees a new option can
 * never be added without inheriting the reset.
 */
export function useMigrationOptions({
  esxiMigrateVm,
  bulkMigOpen,
}: {
  esxiMigrateVm: MigrationDialogVm
  bulkMigOpen: boolean
}) {
  const [migNetworkBridge, setMigNetworkBridge] = useState('')
  // Optional 802.1Q VLAN tag applied to the created VM's NIC. Empty string means
  // "no tag" (access port on the bridge's native VLAN). Stored as string so the
  // input renders cleanly when blank; coerced + validated server-side.
  const [migVlanTag, setMigVlanTag] = useState<string>('')
  const [migStartAfter, setMigStartAfter] = useState(false)
  const [migDiskPaths, setMigDiskPaths] = useState('')
  const [migTempStorage, setMigTempStorage] = useState('/tmp')
  // virt-v2v root filesystem override (#738). Empty means automatic selection;
  // only a genuine multi-boot guest needs the exact root device, copied from
  // the failed job's log.
  const [migV2vRoot, setMigV2vRoot] = useState<string>('')
  // Cold vCenter only (#807): disks downloaded at once over NFC, 1 to 8. Starts
  // at the pipeline default so the slider opens where the engine would run.
  const [migNfcConcurrency, setMigNfcConcurrency] = useState<number>(NFC_CONCURRENCY_DEFAULT)
  const [migType, setMigType] = useState<'cold' | 'sshfs_boot' | 'warm'>('cold')
  // Transfer method is auto-detected by the backend (SSHFS when ESXi SSH is available, HTTPS otherwise).
  // Kept in state for the payload contract; no longer user-selectable in the UI.
  const [migTransferMode, setMigTransferMode] = useState<'https' | 'sshfs' | 'auto'>('auto')
  // Opt-in post-migration qcow2 conversion (#595). Default off: it fully
  // rewrites every migrated disk in the background and transiently doubles
  // the space used on the target storage.
  const [migConvertToQcow2, setMigConvertToQcow2] = useState(false)
  // CPU type of the created VM (roadmap#24). Starts on the Proxmox default so a
  // `host` chosen for one appliance never leaks into the next run.
  // Any QEMU model of the target node once the review step (#317) is used,
  // hence a plain string rather than the quick-list union.
  const [migCpuType, setMigCpuType] = useState<string>(MIGRATION_CPU_TYPE_DEFAULT)
  // Warm only (#443). Off by default: the automatic budget stays the norm, and a
  // hold left on from an earlier run would park a migration nobody is watching.
  const [migManualCutover, setMigManualCutover] = useState(false)
  // Warm VMware only (#1000): default of the guest conversion at cutover. On
  // by default, the operator confirms or changes it in the "Cutover now"
  // dialog; an automatic cutover applies it as is.
  const [migConvertGuest, setMigConvertGuest] = useState(true)
  // UEFI sources, review step (#1000): enrol the Microsoft Secure Boot keys in
  // the EFI disk, the Proxmox default. Off is for a guest whose shim the
  // revocation list rejects (CentOS 8).
  const [migEfiPreEnrolledKeys, setMigEfiPreEnrolledKeys] = useState(true)
  // Warm only, automatic mode only (#663). Seconds, as a string because the
  // payload builder and the API both speak in seconds and the slider snaps to a
  // fixed scale. Starts at the pipeline default so the control opens where the
  // engine would have run anyway.
  const [migDowntimeBudget, setMigDowntimeBudget] = useState(String(DOWNTIME_BUDGET_DEFAULT_SEC))
  // Warm only, thick targets (roadmap#45). MB/s as a string; empty means "the
  // cap of the target PVE connection", 0 means unlimited. Starts empty so
  // a cap typed for one busy array never silently slows the next run.
  const [migZeroRateLimit, setMigZeroRateLimit] = useState('')
  // Bulk only (roadmap#53): how many migrations of the batch run at once, 1 to
  // 5. Starts sequential every time: a wave sized for an idle night must never
  // inherit the parallelism of the previous one.
  const [migBulkConcurrency, setMigBulkConcurrency] = useState<number>(BULK_MIG_CONCURRENCY_DEFAULT)
  // Warm VMware only (roadmap#53): VMkernel adapter of the source host the NFC
  // copy goes through, "vmkN". Empty means the host's default (its adapter
  // tagged vSphereBackupNFC, otherwise management). Starts empty so an adapter
  // picked for one host never applies to a VM running on another.
  const [migCopyVmk, setMigCopyVmk] = useState('')
  // Two-step VMware dialog (#317): 'config' is the form, 'review' the step
  // where the hardware and the NIC mapping of the target are edited. The
  // review state starts empty and is seeded from the source VM when the
  // operator enters the step, so a layout reviewed for one VM never carries
  // over to the next.
  const [migStep, setMigStep] = useState<'config' | 'review'>('config')
  const [migHardware, setMigHardware] = useState<ReviewHardwareState>({ cores: '', sockets: '', memoryMB: '' })
  const [migNics, setMigNics] = useState<ReviewNicState[]>([])

  useEffect(() => {
    if (!esxiMigrateVm && !bulkMigOpen) return
    setMigStep('config')
    setMigHardware({ cores: '', sockets: '', memoryMB: '' })
    setMigNics([])
    setMigNetworkBridge('')
    setMigVlanTag('')
    setMigStartAfter(false)
    setMigDiskPaths(deriveHypervDiskPaths(esxiMigrateVm))
    setMigTempStorage('/tmp')
    setMigV2vRoot('')
    setMigNfcConcurrency(NFC_CONCURRENCY_DEFAULT)
    setMigType('cold')
    setMigTransferMode('auto')
    setMigConvertToQcow2(false)
    setMigCpuType(MIGRATION_CPU_TYPE_DEFAULT)
    setMigManualCutover(false)
    setMigConvertGuest(true)
    setMigEfiPreEnrolledKeys(true)
    setMigDowntimeBudget(String(DOWNTIME_BUDGET_DEFAULT_SEC))
    setMigZeroRateLimit('')
    setMigBulkConcurrency(BULK_MIG_CONCURRENCY_DEFAULT)
    setMigCopyVmk('')
  }, [esxiMigrateVm, bulkMigOpen])

  return {
    migNetworkBridge,
    setMigNetworkBridge,
    migVlanTag,
    setMigVlanTag,
    migStartAfter,
    setMigStartAfter,
    migDiskPaths,
    setMigDiskPaths,
    migTempStorage,
    setMigTempStorage,
    migV2vRoot,
    setMigV2vRoot,
    migNfcConcurrency,
    setMigNfcConcurrency,
    migType,
    setMigType,
    migTransferMode,
    setMigTransferMode,
    migConvertToQcow2,
    setMigConvertToQcow2,
    migCpuType,
    setMigCpuType,
    migManualCutover,
    setMigManualCutover,
    migConvertGuest,
    setMigConvertGuest,
    migEfiPreEnrolledKeys,
    setMigEfiPreEnrolledKeys,
    migDowntimeBudget,
    migBulkConcurrency,
    setMigBulkConcurrency,
    migCopyVmk,
    setMigCopyVmk,
    setMigDowntimeBudget,
    migZeroRateLimit,
    setMigZeroRateLimit,
    migStep,
    setMigStep,
    migHardware,
    setMigHardware,
    migNics,
    setMigNics,
  }
}
