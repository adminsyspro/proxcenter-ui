import { useEffect, useState } from 'react'

import { DOWNTIME_BUDGET_DEFAULT_SEC } from '../components/migrationGuards'

/**
 * Minimal shape of the VM the single-migration dialog was opened for. Only the
 * fields the reset logic needs; InventoryDetails' richer esxiMigrateVm state
 * is structurally assignable to it.
 */
type MigrationDialogVm = { hostType?: string; diskPaths?: string[] } | null | undefined

/**
 * Hyper-V sources with known VHDX paths get migDiskPaths pre-filled: the
 * Windows paths are mapped onto the /mnt/hyperv/ mount the migration pipeline
 * uses ("C:\VMs\TestVM.vhdx" -> "/mnt/hyperv/TestVM.vhdx"). Every other source
 * starts blank. Derived here, inside the reset, because deriving it in the
 * dialog-open click handler would be wiped by the reset effect running right
 * after (state updates from the handler and the open both commit before the
 * effect fires).
 */
function deriveHypervDiskPaths(vm: MigrationDialogVm): string {
  if (!vm || vm.hostType !== 'hyperv' || !vm.diskPaths?.length) return ''

  return vm.diskPaths
    .map(p => `/mnt/hyperv/${p.split('\\').pop() || p.split('/').pop() || p}`)
    .join('\n')
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
  const [migType, setMigType] = useState<'cold' | 'sshfs_boot' | 'warm'>('cold')
  // Transfer method is auto-detected by the backend (SSHFS when ESXi SSH is available, HTTPS otherwise).
  // Kept in state for the payload contract; no longer user-selectable in the UI.
  const [migTransferMode, setMigTransferMode] = useState<'https' | 'sshfs' | 'auto'>('auto')
  // Opt-in post-migration qcow2 conversion (#595). Default off: it fully
  // rewrites every migrated disk in the background and transiently doubles
  // the space used on the target storage.
  const [migConvertToQcow2, setMigConvertToQcow2] = useState(false)
  // Warm only (#443). Off by default: the automatic budget stays the norm, and a
  // hold left on from an earlier run would park a migration nobody is watching.
  const [migManualCutover, setMigManualCutover] = useState(false)
  // Warm only, automatic mode only (#663). Seconds, as a string because the
  // payload builder and the API both speak in seconds and the slider snaps to a
  // fixed scale. Starts at the pipeline default so the control opens where the
  // engine would have run anyway.
  const [migDowntimeBudget, setMigDowntimeBudget] = useState(String(DOWNTIME_BUDGET_DEFAULT_SEC))

  useEffect(() => {
    if (!esxiMigrateVm && !bulkMigOpen) return
    setMigNetworkBridge('')
    setMigVlanTag('')
    setMigStartAfter(false)
    setMigDiskPaths(deriveHypervDiskPaths(esxiMigrateVm))
    setMigTempStorage('/tmp')
    setMigV2vRoot('')
    setMigType('cold')
    setMigTransferMode('auto')
    setMigConvertToQcow2(false)
    setMigManualCutover(false)
    setMigDowntimeBudget(String(DOWNTIME_BUDGET_DEFAULT_SEC))
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
    migType,
    setMigType,
    migTransferMode,
    setMigTransferMode,
    migConvertToQcow2,
    setMigConvertToQcow2,
    migManualCutover,
    setMigManualCutover,
    migDowntimeBudget,
    setMigDowntimeBudget,
  }
}
