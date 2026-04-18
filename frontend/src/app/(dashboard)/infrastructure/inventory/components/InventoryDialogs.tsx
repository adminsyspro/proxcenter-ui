'use client'

import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'

import { useProxCenterTasks } from '@/contexts/ProxCenterTasksContext'

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip as MuiTooltip,
  Typography,
  useTheme,
} from '@mui/material'

import { NodeRow, BulkAction } from '@/components/NodesTable'

// Dynamic imports for HardwareModals (code-split, loaded on demand)
const AddDiskDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.AddDiskDialog })), { ssr: false })
const AddNetworkDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.AddNetworkDialog })), { ssr: false })
const EditDiskDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.EditDiskDialog })), { ssr: false })
const EditNetworkDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.EditNetworkDialog })), { ssr: false })
const EditScsiControllerDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.EditScsiControllerDialog })), { ssr: false })
const AddOtherHardwareDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.AddOtherHardwareDialog })), { ssr: false })
const CloneVmDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.CloneVmDialog })), { ssr: false })
import { MigrateVmDialog, CrossClusterMigrateParams } from '@/components/MigrateVmDialog'

import { BULK_MIG_CONCURRENCY } from '../bulkMigrationConfig'
import CreateVmDialog from '../CreateVmDialog'
import CreateLxcDialog from '../CreateLxcDialog'
import HaGroupDialog from '../HaGroupDialog'
import HaRuleDialog from '../HaRuleDialog'

import type { InventorySelection, DetailsPayload } from '../types'
import { parseNodeId, parseVmId } from '../helpers'
import { AllVmItem, HostItem } from '../InventoryTree'
import { PlayArrowIcon, StopIcon, PowerSettingsNewIcon, MoveUpIcon } from './IconWrappers'
import { useToast } from '@/contexts/ToastContext'

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface InventoryDialogsProps {
  // Core data
  selection: InventorySelection | null
  data: any
  allVms: AllVmItem[]
  hosts: HostItem[]

  // Node action dialog
  nodeActionDialog: { action: 'reboot' | 'shutdown'; nodeName: string; connId?: string; node?: string } | null
  setNodeActionDialog: (v: { action: 'reboot' | 'shutdown'; nodeName: string; connId?: string; node?: string } | null) => void
  nodeActionBusy: boolean
  setNodeActionBusy: (v: boolean) => void
  nodeActionStep: string | null
  setNodeActionStep: (v: string | null) => void
  nodeActionMigrateTarget: string
  setNodeActionMigrateTarget: (v: string) => void
  nodeActionFailedVms: { vmid: string; name: string; connId: string; type: string; node: string; error: string }[]
  setNodeActionFailedVms: (v: { vmid: string; name: string; connId: string; type: string; node: string; error: string }[]) => void
  nodeActionShutdownFailed: boolean
  setNodeActionShutdownFailed: (v: boolean) => void
  nodeActionLocalVms: Set<string>
  nodeActionStorageLoading: boolean
  nodeActionShutdownLocal: boolean
  setNodeActionShutdownLocal: (v: boolean) => void

  // Create VM/LXC dialogs
  createVmDialogOpen: boolean
  setCreateVmDialogOpen: (v: boolean) => void
  createLxcDialogOpen: boolean
  setCreateLxcDialogOpen: (v: boolean) => void
  effectiveCreateDefaults: { connId?: string; node?: string }
  handleVmCreated: (vmid: string, connId: string, node: string) => void
  handleLxcCreated: (ctid: string, connId: string, node: string) => void

  // Hardware dialogs
  addDiskDialogOpen: boolean
  setAddDiskDialogOpen: (v: boolean) => void
  addNetworkDialogOpen: boolean
  setAddNetworkDialogOpen: (v: boolean) => void
  editScsiControllerDialogOpen: boolean
  setEditScsiControllerDialogOpen: (v: boolean) => void
  editDiskDialogOpen: boolean
  setEditDiskDialogOpen: (v: boolean) => void
  editNetworkDialogOpen: boolean
  setEditNetworkDialogOpen: (v: boolean) => void
  addOtherHardwareDialogOpen: boolean
  setAddOtherHardwareDialogOpen: (v: boolean) => void
  selectedDisk: any
  setSelectedDisk: (v: any) => void
  selectedNetwork: any
  setSelectedNetwork: (v: any) => void
  handleSaveDisk: (...args: any[]) => any
  handleSaveNetwork: (...args: any[]) => any
  handleSaveScsiController: (...args: any[]) => any
  handleEditDisk: (...args: any[]) => any
  handleDeleteDisk: (...args: any[]) => any
  handleResizeDisk: (...args: any[]) => any
  handleMoveDisk: (...args: any[]) => any
  handleDeleteNetwork: (...args: any[]) => any

  // Migrate / Clone dialogs (from VM detail)
  migrateDialogOpen: boolean
  setMigrateDialogOpen: (v: boolean) => void
  cloneDialogOpen: boolean
  setCloneDialogOpen: (v: boolean) => void
  handleMigrateVm: (...args: any[]) => any
  handleCrossClusterMigrate: (params: CrossClusterMigrateParams) => any
  handleCloneVm: (...args: any[]) => any
  selectedVmIsCluster: boolean

  // Migrate / Clone dialogs (from table)
  tableMigrateVm: any
  setTableMigrateVm: (v: any) => void
  tableCloneVm: any
  setTableCloneVm: (v: any) => void
  handleTableMigrateVm: (...args: any[]) => any
  handleTableCrossClusterMigrate: (params: CrossClusterMigrateParams) => any
  handleTableCloneVm: (...args: any[]) => any

  // Edit option dialog
  editOptionDialog: { key: string; label: string; value: any; type: 'text' | 'boolean' | 'select' | 'hotplug'; options?: { value: string; label: string }[] } | null
  setEditOptionDialog: (v: any) => void
  editOptionValue: any
  setEditOptionValue: (v: any) => void
  editOptionSaving: boolean
  handleSaveOption: () => Promise<void>

  // HA dialogs
  haGroupDialogOpen: boolean
  setHaGroupDialogOpen: (v: boolean) => void
  editingHaGroup: any
  setEditingHaGroup: (v: any) => void
  deleteHaGroupDialog: any
  setDeleteHaGroupDialog: (v: any) => void
  haRuleDialogOpen: boolean
  setHaRuleDialogOpen: (v: boolean) => void
  editingHaRule: any
  setEditingHaRule: (v: any) => void
  deleteHaRuleDialog: any
  setDeleteHaRuleDialog: (v: any) => void
  haRuleType: 'node-affinity' | 'resource-affinity'
  clusterHaResources: any[]
  clusterPveMajorVersion: number
  loadClusterHa: (connId: string) => void

  // Confirm action dialog
  confirmAction: { action: string; title: string; message: string; vmName?: string; onConfirm: () => Promise<void> } | null
  setConfirmAction: (v: any) => void
  confirmActionLoading: boolean

  // Backup dialog
  createBackupDialogOpen: boolean
  setCreateBackupDialogOpen: (v: boolean) => void
  backupStorage: string
  setBackupStorage: (v: string) => void
  backupMode: 'snapshot' | 'suspend' | 'stop'
  setBackupMode: (v: 'snapshot' | 'suspend' | 'stop') => void
  backupCompress: 'zstd' | 'lzo' | 'gzip' | 'none'
  setBackupCompress: (v: 'zstd' | 'lzo' | 'gzip' | 'none') => void
  backupNote: string
  setBackupNote: (v: string) => void
  creatingBackup: boolean
  setCreatingBackup: (v: boolean) => void
  backupStorages: any[]
  loadBackups: (vmid: string, vmType: string) => void

  // Delete VM dialog
  deleteVmDialogOpen: boolean
  setDeleteVmDialogOpen: (v: boolean) => void
  deleteVmConfirmText: string
  setDeleteVmConfirmText: (v: string) => void
  deletingVm: boolean
  deleteVmPurge: boolean
  setDeleteVmPurge: (v: boolean) => void
  handleDeleteVm: () => Promise<void>

  // Convert to template dialog
  convertTemplateDialogOpen: boolean
  setConvertTemplateDialogOpen: (v: boolean) => void
  convertingTemplate: boolean
  handleConvertTemplate: () => Promise<void>

  // Unlock error dialog
  unlockErrorDialog: { open: boolean; error: string; hint?: string; lockType?: string }
  setUnlockErrorDialog: (v: { open: boolean; error: string; hint?: string; lockType?: string }) => void

  // Bulk action dialog
  bulkActionDialog: { open: boolean; action: BulkAction | null; node: NodeRow | null; targetNode: string }
  setBulkActionDialog: (v: any) => void
  executeBulkAction: () => void

  // ESXi / External migration dialog
  esxiMigrateVm: { vmid: string; name: string; connId: string; connName: string; cpu?: number; memoryMB?: number; committed?: number; guestOS?: string; licenseFull?: boolean; hostType?: string; diskPaths?: string[]; status?: string; toolsStatus?: string; toolsRunningStatus?: string } | null
  setEsxiMigrateVm: (v: any) => void
  migTargetConn: string
  setMigTargetConn: (v: string) => void
  migTargetNode: string
  setMigTargetNode: (v: string) => void
  migTargetStorage: string
  setMigTargetStorage: (v: string) => void
  migNetworkBridge: string
  setMigNetworkBridge: (v: string) => void
  migBridges: any[]
  migStartAfter: boolean
  setMigStartAfter: (v: boolean) => void
  migDiskPaths: string
  setMigDiskPaths: (v: string) => void
  migTempStorage: string
  setMigTempStorage: (v: string) => void
  migType: 'cold' | 'live' | 'sshfs_boot'
  setMigType: (v: 'cold' | 'live' | 'sshfs_boot') => void
  migTransferMode: 'https' | 'sshfs'
  setMigTransferMode: (v: 'https' | 'sshfs') => void
  migPveConnections: any[]
  migNodes: any[]
  migStorages: any[]
  migSshfsAvailable: boolean | null
  vcenterPreflight: { checked: boolean; ok: boolean; installing: boolean; errors: string[]; virtV2vInstalled: boolean; virtioWinInstalled: boolean; nbdkitInstalled: boolean; nbdcopyInstalled: boolean; guestfsToolsInstalled: boolean; ovmfInstalled: boolean; detectedDisks: string[]; tempStorages: { path: string; availableBytes: number; totalBytes: number; filesystem: string }[] } | null
  setVcenterPreflight: (v: any) => void
  migStarting: boolean
  setMigStarting: (v: boolean) => void
  migJobId: string | null
  setMigJobId: (v: string | null) => void
  migJob: any
  setMigJob: (v: any) => void
  migNodeOptions: any[]

  // Bulk migration
  bulkMigSelected: Set<string>
  setBulkMigSelected: (v: Set<string>) => void
  bulkMigOpen: boolean
  setBulkMigOpen: (v: boolean) => void
  bulkMigStarting: boolean
  setBulkMigStarting: (v: boolean) => void
  bulkMigJobs: { vmid: string; name: string; jobId: string; status: string; progress: number; error?: string; logs?: { ts: string; msg: string; level: string }[]; targetNode?: string }[]
  setBulkMigJobs: (v: any) => void
  bulkMigProgressExpanded: boolean
  setBulkMigProgressExpanded: (v: React.SetStateAction<boolean>) => void
  bulkMigLogsExpanded: boolean
  setBulkMigLogsExpanded: (v: React.SetStateAction<boolean>) => void
  bulkMigLogsFilter: string | null
  setBulkMigLogsFilter: (v: string | null) => void
  bulkMigConfigRef: React.MutableRefObject<{ sourceConnectionId: string; targetConnectionId: string; targetStorage: string; networkBridge: string; migrationType: string; transferMode: string; startAfterMigration: boolean; sourceType: string; tempStorage?: string } | null>
  bulkMigHostInfo: any

  // Upgrade dialog
  upgradeDialogOpen: boolean
  setUpgradeDialogOpen: (v: boolean) => void
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

/*
 * BULK_MIG_CONCURRENCY now lives in ./bulkMigrationConfig.ts so the dispatcher
 * here and the queued-job poller in ../InventoryDetails.tsx read the same
 * value. Previously each file declared its own copy and they silently drifted
 * (dialogs at 1, details at 2) which made bulk migrations still run 2 in
 * parallel after we lowered the dispatcher's count.
 */

/**
 * A <pre>-style code block with an overlaid "Copy" button. The command is
 * copied to the user's clipboard via the Clipboard API on click, and the icon
 * swaps to a checkmark for ~1.5s to give visual confirmation. Used by the
 * virtio-win manual install instructions so the user can paste straight into
 * their Proxmox SSH session without hand-selecting the text.
 *
 * Extracted as its own component because it carries a tiny local state (the
 * "copied" flag) which can't live inside the IIFEs that render the preflight
 * checklists around it.
 */
function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      // navigator.clipboard is the modern API; falls back to a no-op if the
      // browser blocked it (insecure context, permissions). Not worth a
      // textarea-select-exec fallback given ProxCenter already requires a
      // secure HTTPS context for auth.
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // swallow — user can still select + copy manually
    }
  }
  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        component="pre"
        sx={{
          bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)',
          p: 1, pr: 5, borderRadius: 1, fontSize: 10, m: 0, overflow: 'auto',
          fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}
      >
        {command}
      </Box>
      <IconButton
        size="small"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
        sx={{
          position: 'absolute', top: 4, right: 4,
          bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          '&:hover': { bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)' },
        }}
      >
        <i className={copied ? 'ri-check-line' : 'ri-file-copy-line'} style={{ fontSize: 14, color: copied ? '#2e7d32' : undefined }} />
      </IconButton>
    </Box>
  )
}

export default function InventoryDialogs(props: InventoryDialogsProps) {
  const {
    selection, data, allVms, hosts,
    nodeActionDialog, setNodeActionDialog, nodeActionBusy, setNodeActionBusy, nodeActionStep, setNodeActionStep,
    nodeActionMigrateTarget, setNodeActionMigrateTarget, nodeActionFailedVms, setNodeActionFailedVms,
    nodeActionShutdownFailed, setNodeActionShutdownFailed, nodeActionLocalVms, nodeActionStorageLoading,
    nodeActionShutdownLocal, setNodeActionShutdownLocal,
    createVmDialogOpen, setCreateVmDialogOpen, createLxcDialogOpen, setCreateLxcDialogOpen,
    effectiveCreateDefaults, handleVmCreated, handleLxcCreated,
    addDiskDialogOpen, setAddDiskDialogOpen, addNetworkDialogOpen, setAddNetworkDialogOpen,
    editScsiControllerDialogOpen, setEditScsiControllerDialogOpen, editDiskDialogOpen, setEditDiskDialogOpen,
    editNetworkDialogOpen, setEditNetworkDialogOpen, addOtherHardwareDialogOpen, setAddOtherHardwareDialogOpen,
    selectedDisk, setSelectedDisk, selectedNetwork, setSelectedNetwork,
    handleSaveDisk, handleSaveNetwork, handleSaveScsiController, handleEditDisk, handleDeleteDisk,
    handleResizeDisk, handleMoveDisk, handleDeleteNetwork,
    migrateDialogOpen, setMigrateDialogOpen, cloneDialogOpen, setCloneDialogOpen,
    handleMigrateVm, handleCrossClusterMigrate, handleCloneVm, selectedVmIsCluster,
    tableMigrateVm, setTableMigrateVm, tableCloneVm, setTableCloneVm,
    handleTableMigrateVm, handleTableCrossClusterMigrate, handleTableCloneVm,
    editOptionDialog, setEditOptionDialog, editOptionValue, setEditOptionValue, editOptionSaving, handleSaveOption,
    haGroupDialogOpen, setHaGroupDialogOpen, editingHaGroup, setEditingHaGroup,
    deleteHaGroupDialog, setDeleteHaGroupDialog, haRuleDialogOpen, setHaRuleDialogOpen,
    editingHaRule, setEditingHaRule, deleteHaRuleDialog, setDeleteHaRuleDialog,
    haRuleType, clusterHaResources, clusterPveMajorVersion, loadClusterHa,
    confirmAction, setConfirmAction, confirmActionLoading,
    createBackupDialogOpen, setCreateBackupDialogOpen, backupStorage, setBackupStorage,
    backupMode, setBackupMode, backupCompress, setBackupCompress, backupNote, setBackupNote,
    creatingBackup, setCreatingBackup, backupStorages, loadBackups,
    deleteVmDialogOpen, setDeleteVmDialogOpen, deleteVmConfirmText, setDeleteVmConfirmText,
    deletingVm, deleteVmPurge, setDeleteVmPurge, handleDeleteVm,
    convertTemplateDialogOpen, setConvertTemplateDialogOpen, convertingTemplate, handleConvertTemplate,
    unlockErrorDialog, setUnlockErrorDialog,
    bulkActionDialog, setBulkActionDialog, executeBulkAction,
    esxiMigrateVm, setEsxiMigrateVm, migTargetConn, setMigTargetConn, migTargetNode, setMigTargetNode,
    migTargetStorage, setMigTargetStorage, migNetworkBridge, setMigNetworkBridge, migBridges,
    migStartAfter, setMigStartAfter, migDiskPaths, setMigDiskPaths, migTempStorage, setMigTempStorage,
    migType, setMigType, migTransferMode, setMigTransferMode, migPveConnections, migNodes, migStorages,
    migSshfsAvailable, vcenterPreflight, setVcenterPreflight, migStarting, setMigStarting,
    migJobId, setMigJobId, migJob, setMigJob, migNodeOptions,
    bulkMigSelected, setBulkMigSelected, bulkMigOpen, setBulkMigOpen, bulkMigStarting, setBulkMigStarting,
    bulkMigJobs, setBulkMigJobs, bulkMigProgressExpanded, setBulkMigProgressExpanded,
    bulkMigLogsExpanded, setBulkMigLogsExpanded, bulkMigLogsFilter, setBulkMigLogsFilter,
    bulkMigConfigRef, bulkMigHostInfo,
    upgradeDialogOpen, setUpgradeDialogOpen,
  } = props

  const t = useTranslations()
  const theme = useTheme()
  const toast = useToast()
  const { addTask: addPCTask, registerOnRestore } = useProxCenterTasks()

  // virtio-win ISO download progress (background curl + polling)
  const [virtioWinProgress, setVirtioWinProgress] = useState<{ downloading: boolean; percent: number; sizeBytes: number } | null>(null)
  const virtioWinPollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup polling on unmount
  React.useEffect(() => {
    return () => { if (virtioWinPollRef.current) clearInterval(virtioWinPollRef.current) }
  }, [])

  const startVirtioWinDownload = async () => {
    const installNodes = migTargetNode === '__auto__'
      ? migNodeOptions.filter((o: any) => o.connId === migTargetConn && o.status === 'online').map((o: any) => o.node)
      : [migTargetNode]
    if (installNodes.length === 0) return

    // Start background download on all target nodes
    setVirtioWinProgress({ downloading: true, percent: 0, sizeBytes: 0 })
    await Promise.all(installNodes.map((node: string) => fetch('/api/v1/migrations/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: node, action: 'install-virtio-win' }),
    }))).catch(() => {})

    // Poll progress every 2s (check first node as representative)
    const pollNode = installNodes[0]
    virtioWinPollRef.current = setInterval(async () => {
      try {
        const r = await fetch('/api/v1/migrations/preflight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: pollNode, action: 'check-virtio-win' }),
        })
        const d = await r.json()
        setVirtioWinProgress({ downloading: d.downloading, percent: d.percent || 0, sizeBytes: d.sizeBytes || 0 })
        if (d.done) {
          if (virtioWinPollRef.current) clearInterval(virtioWinPollRef.current)
          virtioWinPollRef.current = null
          setVirtioWinProgress(null)
          // Re-run preflight to update checklist
          const results = await Promise.all(installNodes.map(async (node: string) => {
            const r2 = await fetch('/api/v1/migrations/preflight', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: node }),
            })
            return r2.json()
          }))
          setVcenterPreflight({
            checked: true,
            ok: results.every((r: any) => !(r.errors || []).length),
            installing: false,
            errors: [],
            virtV2vInstalled: results.every((r: any) => !!r.virtV2vInstalled),
            virtioWinInstalled: results.every((r: any) => !!r.virtioWinInstalled),
            nbdkitInstalled: results.every((r: any) => !!r.nbdkitInstalled),
            nbdcopyInstalled: results.every((r: any) => !!r.nbdcopyInstalled),
            guestfsToolsInstalled: results.every((r: any) => !!r.guestfsToolsInstalled),
            ovmfInstalled: results.every((r: any) => !!r.ovmfInstalled),
            detectedDisks: [],
            tempStorages: results[0]?.tempStorages || [],
          })
        }
      } catch {}
    }, 2000)
  }

  return (
    <>
      {/* Node Reboot/Shutdown confirmation dialog */}
      {(() => {
        const resolvedConnId = nodeActionDialog?.connId || (selection?.type === 'node' ? parseNodeId(selection.id).connId : '')
        const resolvedNode = nodeActionDialog?.node || (selection?.type === 'node' ? parseNodeId(selection.id).node : '')
        const runningVmsOnNode = allVms.filter(vm =>
          vm.connId === resolvedConnId && vm.node === resolvedNode && vm.status === 'running' && !vm.template
        )
        const otherOnlineNodes = hosts.filter(h =>
          h.connId === resolvedConnId && h.node !== resolvedNode
        )
        const isClusterNode = otherOnlineNodes.length > 0
        return (
                <Dialog
                  open={nodeActionDialog !== null}
                  onClose={() => { if (!nodeActionBusy) { setNodeActionDialog(null); setNodeActionStep(null); setNodeActionMigrateTarget(''); setNodeActionFailedVms([]); setNodeActionShutdownFailed(false); setNodeActionShutdownLocal(false) } }}
                  maxWidth="sm"
                  fullWidth
                >
                  <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{
                      width: 40, height: 40, borderRadius: 2,
                      bgcolor: nodeActionDialog?.action === 'reboot' ? 'rgba(245,158,11,0.12)' : 'rgba(198,40,40,0.12)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <i
                        className={nodeActionDialog?.action === 'reboot' ? 'ri-restart-line' : 'ri-shut-down-line'}
                        style={{ fontSize: 22, color: nodeActionDialog?.action === 'reboot' ? '#f59e0b' : '#c62828' }}
                      />
                    </Box>
                    {nodeActionDialog?.action === 'reboot' ? t('inventory.nodeReboot') : t('inventory.nodeShutdown')}
                  </DialogTitle>
                  <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <DialogContentText>
                      <strong>{nodeActionDialog?.nodeName}</strong> &mdash;{' '}
                      {nodeActionDialog?.action === 'reboot'
                        ? t('inventory.confirmNodeReboot')
                        : t('inventory.confirmNodeShutdown')}
                    </DialogContentText>
  
                    {/* Running VMs info */}
                    {runningVmsOnNode.length > 0 ? (() => {
                      const sharedVms = isClusterNode ? runningVmsOnNode.filter(vm => !nodeActionLocalVms.has(`${vm.connId}:${vm.vmid}`)) : []
                      const localVms = isClusterNode ? runningVmsOnNode.filter(vm => nodeActionLocalVms.has(`${vm.connId}:${vm.vmid}`)) : runningVmsOnNode

                      return (<>
                      {/* Loading storage check */}
                      {nodeActionStorageLoading && isClusterNode && (
                        <Alert severity="info" icon={<CircularProgress size={18} />}>
                          <Typography variant="body2">{t('inventory.nodeActionAnalyzingStorage')}</Typography>
                        </Alert>
                      )}

                      {/* Shared storage VMs — will be auto-migrated */}
                      {!nodeActionStorageLoading && isClusterNode && sharedVms.length > 0 && (
                        <Alert severity="success" icon={<i className="ri-upload-2-line" style={{ fontSize: 20 }} />}>
                          <Typography variant="body2" fontWeight={600}>
                            {t('inventory.nodeActionSharedVms', { count: sharedVms.length })}
                          </Typography>
                          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {sharedVms.slice(0, 8).map(vm => (
                              <Chip key={`${vm.connId}:${vm.vmid}`} size="small" label={`${vm.vmid} ${vm.name}`}
                                icon={<i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: 14 }} />}
                                variant="outlined" color="success" />
                            ))}
                            {sharedVms.length > 8 && <Chip size="small" label={`+${sharedVms.length - 8}`} variant="outlined" />}
                          </Box>
                        </Alert>
                      )}

                      {/* Local storage VMs — cannot be migrated */}
                      {!nodeActionStorageLoading && localVms.length > 0 && (
                        <Alert severity={isClusterNode ? 'warning' : 'info'} icon={<i className={isClusterNode ? 'ri-hard-drive-2-line' : 'ri-computer-line'} style={{ fontSize: 20 }} />}>
                          <Typography variant="body2" fontWeight={600}>
                            {isClusterNode
                              ? t('inventory.nodeActionLocalVms', { count: localVms.length })
                              : t('inventory.nodeActionRunningVms', { count: localVms.length })}
                          </Typography>
                          <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
                            {isClusterNode
                              ? t('inventory.nodeActionLocalVmsDesc')
                              : t('inventory.nodeActionStandaloneShutdownDesc')}
                          </Typography>
                          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {localVms.slice(0, 8).map(vm => (
                              <Chip key={`${vm.connId}:${vm.vmid}`} size="small" label={`${vm.vmid} ${vm.name}`}
                                icon={<i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: 14 }} />}
                                variant="outlined" color="warning" />
                            ))}
                            {localVms.length > 8 && <Chip size="small" label={`+${localVms.length - 8}`} variant="outlined" />}
                          </Box>
                          {isClusterNode && (
                            <Box
                              onClick={() => !nodeActionBusy && setNodeActionShutdownLocal(!nodeActionShutdownLocal)}
                              sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1, cursor: nodeActionBusy ? 'default' : 'pointer' }}
                            >
                              <Checkbox size="small" checked={nodeActionShutdownLocal} disabled={nodeActionBusy} sx={{ p: 0 }} />
                              <Typography variant="body2">{t('inventory.nodeActionShutdownLocalOption')}</Typography>
                            </Box>
                          )}
                        </Alert>
                      )}

                      {/* Target node selector — only if there are VMs to migrate */}
                      {!nodeActionStorageLoading && isClusterNode && sharedVms.length > 0 && (
                        <FormControl fullWidth size="small">
                          <InputLabel>{t('inventory.nodeActionMigrateTarget')}</InputLabel>
                          <Select
                            value={nodeActionMigrateTarget}
                            label={t('inventory.nodeActionMigrateTarget')}
                            onChange={(e) => setNodeActionMigrateTarget(e.target.value)}
                            disabled={nodeActionBusy}
                          >
                            {otherOnlineNodes.map(h => (
                              <MenuItem key={h.node} value={h.node}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                    <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 14, height: 14, opacity: 0.8 }} />
                                    <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: 'success.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                                  </Box>
                                  {h.node}
                                </Box>
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      )}

                      {/* Failed VMs after migration attempt */}
                      {nodeActionFailedVms.length > 0 && (
                        <Alert severity="error" icon={<i className="ri-error-warning-line" style={{ fontSize: 20 }} />}>
                          <Typography variant="body2" fontWeight={600}>
                            {t('inventory.nodeActionMigrateFailed', { count: nodeActionFailedVms.length })}
                          </Typography>
                          <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
                            {t('inventory.nodeActionMigrateFailedDesc')}
                          </Typography>
                          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {nodeActionFailedVms.map(vm => (
                              <MuiTooltip key={vm.vmid} title={vm.error}>
                                <Chip size="small" label={`${vm.vmid} ${vm.name}`} variant="outlined" color="error" />
                              </MuiTooltip>
                            ))}
                          </Box>
                          <Box
                            onClick={() => !nodeActionBusy && setNodeActionShutdownFailed(!nodeActionShutdownFailed)}
                              sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1, cursor: nodeActionBusy ? 'default' : 'pointer' }}
                            >
                              <Checkbox size="small" checked={nodeActionShutdownFailed} disabled={nodeActionBusy} sx={{ p: 0 }} />
                              <Typography variant="body2">{t('inventory.nodeActionShutdownFailedOption')}</Typography>
                            </Box>
                          </Alert>
                        )}
                    </>)
                    })() : (
                      <Alert severity="success" icon={<i className="ri-checkbox-circle-line" style={{ fontSize: 20 }} />}>
                        <Typography variant="body2">{t('inventory.nodeActionNoRunningVms')}</Typography>
                      </Alert>
                    )}
  
                    {/* Maintenance mode info */}
                    {isClusterNode && (
                      <Alert severity="info" icon={<i className="ri-tools-line" style={{ fontSize: 20 }} />} sx={{ mt: 0 }}>
                        <Typography variant="body2">{t('inventory.nodeActionMaintenanceAuto')}</Typography>
                      </Alert>
                    )}
  
                    {/* Progress steps */}
                    {nodeActionStep && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                        <CircularProgress size={18} />
                        <Typography variant="body2" sx={{ fontStyle: 'italic' }}>{nodeActionStep}</Typography>
                      </Box>
                    )}
                  </DialogContent>
                  <DialogActions>
                    <Button
                      onClick={() => { setNodeActionDialog(null); setNodeActionStep(null); setNodeActionMigrateTarget(''); setNodeActionFailedVms([]); setNodeActionShutdownFailed(false) }}
                      color="inherit"
                      disabled={nodeActionBusy}
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      variant="contained"
                      color={nodeActionDialog?.action === 'reboot' ? 'warning' : 'error'}
                      disabled={(() => {
                        if (nodeActionBusy || nodeActionStorageLoading) return true
                        if (nodeActionFailedVms.length > 0 && !nodeActionShutdownFailed) return true
                        if (isClusterNode && runningVmsOnNode.length > 0) {
                          const hasShared = runningVmsOnNode.length > nodeActionLocalVms.size
                          const hasLocal = nodeActionLocalVms.size > 0
                          if (hasShared && !nodeActionMigrateTarget) return true
                          if (hasLocal && !nodeActionShutdownLocal) return true
                        }
                        return false
                      })()}
                      startIcon={nodeActionBusy ? <CircularProgress size={16} /> : undefined}
                      onClick={async () => {
                        if (!nodeActionDialog || !resolvedConnId || !resolvedNode) return
                        setNodeActionBusy(true)
                        const connId = resolvedConnId
                        const node = resolvedNode
  
                        try {
                          // Step 1: Handle running VMs
                          if (runningVmsOnNode.length > 0) {
                            if (isClusterNode) {
                              // Migrate shared-storage VMs
                              const sharedVms = runningVmsOnNode.filter(vm => !nodeActionLocalVms.has(`${vm.connId}:${vm.vmid}`))
                              const localVms = runningVmsOnNode.filter(vm => nodeActionLocalVms.has(`${vm.connId}:${vm.vmid}`))

                              if (sharedVms.length > 0 && nodeActionMigrateTarget && nodeActionFailedVms.length === 0) {
                                setNodeActionStep(t('inventory.nodeActionMigratingStep', { done: 0, total: sharedVms.length }))
                                let done = 0
                                const failed: { vmid: string; name: string; connId: string; type: string; node: string; error: string }[] = []
                                const batchSize = 3
                                for (let i = 0; i < sharedVms.length; i += batchSize) {
                                  const batch = sharedVms.slice(i, i + batchSize)
                                  await Promise.all(batch.map(async (vm) => {
                                    try {
                                      const url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/migrate`
                                      const res = await fetch(url, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ target: nodeActionMigrateTarget, online: true }),
                                      })
                                      if (!res.ok) {
                                        const err = await res.json().catch(() => ({}))
                                        failed.push({ vmid: vm.vmid, name: vm.name, connId: vm.connId, type: vm.type, node: vm.node, error: err?.error || `HTTP ${res.status}` })
                                      }
                                    } catch (e: any) {
                                      failed.push({ vmid: vm.vmid, name: vm.name, connId: vm.connId, type: vm.type, node: vm.node, error: e?.message || 'Unknown error' })
                                    }
                                    done++
                                    setNodeActionStep(t('inventory.nodeActionMigratingStep', { done, total: sharedVms.length }))
                                  }))
                                }
                                if (failed.length > 0) {
                                  setNodeActionFailedVms(failed)
                                  setNodeActionStep(null)
                                  setNodeActionBusy(false)
                                  return
                                }
                              } else if (nodeActionFailedVms.length > 0 && nodeActionShutdownFailed) {
                                // Shutdown VMs that failed migration
                                setNodeActionStep(t('inventory.nodeActionShutdownVmsStep', { done: 0, total: nodeActionFailedVms.length }))
                                let done = 0
                                for (const vm of nodeActionFailedVms) {
                                  const url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/shutdown`
                                  await fetch(url, { method: 'POST' }).catch(() => {})
                                  done++
                                  setNodeActionStep(t('inventory.nodeActionShutdownVmsStep', { done, total: nodeActionFailedVms.length }))
                                }
                                setNodeActionStep(t('inventory.nodeActionWaitingVmsStop'))
                                await new Promise(resolve => setTimeout(resolve, 5000))
                              }

                              // Shutdown local-storage VMs (user checked the option)
                              if (localVms.length > 0 && nodeActionShutdownLocal) {
                                setNodeActionStep(t('inventory.nodeActionShutdownVmsStep', { done: 0, total: localVms.length }))
                                let done = 0
                                for (const vm of localVms) {
                                  const url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/shutdown`
                                  await fetch(url, { method: 'POST' }).catch(() => {})
                                  done++
                                  setNodeActionStep(t('inventory.nodeActionShutdownVmsStep', { done, total: localVms.length }))
                                }
                                setNodeActionStep(t('inventory.nodeActionWaitingVmsStop'))
                                await new Promise(resolve => setTimeout(resolve, 5000))
                              }
                            } else {
                              // Standalone: shutdown all VMs
                              setNodeActionStep(t('inventory.nodeActionShutdownVmsStep', { done: 0, total: runningVmsOnNode.length }))
                              let done = 0
                              const batchSize = 5
                              for (let i = 0; i < runningVmsOnNode.length; i += batchSize) {
                                const batch = runningVmsOnNode.slice(i, i + batchSize)
                                await Promise.all(batch.map(async (vm) => {
                                  const url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/shutdown`
                                  await fetch(url, { method: 'POST' }).catch(() => {})
                                  done++
                                  setNodeActionStep(t('inventory.nodeActionShutdownVmsStep', { done, total: runningVmsOnNode.length }))
                                }))
                              }
                              setNodeActionStep(t('inventory.nodeActionWaitingVmsStop'))
                              await new Promise(resolve => setTimeout(resolve, 5000))
                            }
                          }
  
                          // Step 2: Enter maintenance mode (cluster only)
                          if (isClusterNode) {
                            setNodeActionStep(t('inventory.nodeActionMaintenanceStep'))
                            try {
                              await fetch(
                                `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/maintenance`,
                                { method: 'POST' }
                              )
                            } catch {
                              // Non-blocking
                            }
                          }
  
                          // Step 3: Execute reboot/shutdown
                          setNodeActionStep(t('inventory.nodeActionExecuteStep', { action: nodeActionDialog.action }))
                          const res = await fetch(
                            `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/status`,
                            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: nodeActionDialog.action }) }
                          )
                          const json = await res.json()
                          if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`)
  
                          toast.success(nodeActionDialog.action === 'reboot' ? t('inventory.nodeRebootSuccess') : t('inventory.nodeShutdownSuccess'))
                          setNodeActionDialog(null)
                          setNodeActionStep(null)
                          setNodeActionMigrateTarget('')
                          setNodeActionFailedVms([])
                          setNodeActionShutdownFailed(false)
                          fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
                        } catch (e: any) {
                          toast.error(`${t('common.error')}: ${e?.message || e}`)
                          setNodeActionStep(null)
                        } finally {
                          setNodeActionBusy(false)
                        }
                      }}
                    >
                      {t('common.confirm')}
                    </Button>
                  </DialogActions>
                </Dialog>
        )
      })()}

      {/* Dialog Créer VM */}
      <CreateVmDialog
        open={createVmDialogOpen}
        onClose={() => setCreateVmDialogOpen(false)}
        allVms={allVms}
        onCreated={handleVmCreated}
        defaultConnId={effectiveCreateDefaults.connId}
        defaultNode={effectiveCreateDefaults.node}
      />

      {/* Dialog Créer LXC */}
      <CreateLxcDialog
        open={createLxcDialogOpen}
        onClose={() => setCreateLxcDialogOpen(false)}
        allVms={allVms}
        onCreated={handleLxcCreated}
        defaultConnId={effectiveCreateDefaults.connId}
        defaultNode={effectiveCreateDefaults.node}
      />

      {/* Dialogs Hardware */}
      {selection?.type === 'vm' && (() => {
        const { connId, node, vmid, type } = parseVmId(selection.id)
        const existingDisks = data?.disksInfo?.map((d: any) => d.id) || []
        const existingNets = data?.networkInfo?.map((n: any) => n.id) || []
        
        return (
          <>
            <AddDiskDialog
              open={addDiskDialogOpen}
              onClose={() => setAddDiskDialogOpen(false)}
              onSave={handleSaveDisk}
              connId={connId}
              node={node}
              vmid={vmid}
              existingDisks={existingDisks}
            />
            
            <AddNetworkDialog
              open={addNetworkDialogOpen}
              onClose={() => setAddNetworkDialogOpen(false)}
              onSave={handleSaveNetwork}
              connId={connId}
              node={node}
              vmid={vmid}
              existingNets={existingNets}
            />
            
            <EditScsiControllerDialog
              open={editScsiControllerDialogOpen}
              onClose={() => setEditScsiControllerDialogOpen(false)}
              onSave={handleSaveScsiController}
              currentController={data?.optionsInfo?.scsihw || 'virtio-scsi-single'}
            />
            
            <EditDiskDialog
              open={editDiskDialogOpen}
              onClose={() => {
                setEditDiskDialogOpen(false)
                setSelectedDisk(null)
              }}
              onSave={handleEditDisk}
              onDelete={handleDeleteDisk}
              onResize={handleResizeDisk}
              onMoveStorage={handleMoveDisk}
              connId={connId}
              node={node}
              disk={selectedDisk}
              existingDisks={data?.disksInfo?.map((d: any) => d.id) || []}
            />

            <EditNetworkDialog
              open={editNetworkDialogOpen}
              onClose={() => {
                setEditNetworkDialogOpen(false)
                setSelectedNetwork(null)
              }}
              onSave={handleSaveNetwork}
              onDelete={handleDeleteNetwork}
              connId={connId}
              node={node}
              network={selectedNetwork}
            />

            <AddOtherHardwareDialog
              open={addOtherHardwareDialogOpen}
              onClose={() => setAddOtherHardwareDialogOpen(false)}
              onSave={handleSaveDisk}
              connId={connId}
              node={node}
              vmid={vmid}
              existingHardware={[
                ...(data?.disksInfo?.map((d: any) => d.id) || []),
                ...(data?.otherHardwareInfo?.map((h: any) => h.id) || []),
                ...(data?.cloudInitConfig?.drive ? ['cloudinit'] : []),
              ]}
            />

            {/* Dialog de migration */}
            <MigrateVmDialog
              open={migrateDialogOpen}
              onClose={() => setMigrateDialogOpen(false)}
              onMigrate={handleMigrateVm}
              onCrossClusterMigrate={handleCrossClusterMigrate}
              connId={connId}
              currentNode={node}
              vmName={data?.name || `VM ${vmid}`}
              vmid={vmid}
              vmStatus={data?.vmRealStatus || data?.status || 'unknown'}
              vmType={type as 'qemu' | 'lxc'}
              isCluster={selectedVmIsCluster}
            />
            
            {/* Dialog de clonage */}
            <CloneVmDialog
              open={cloneDialogOpen}
              onClose={() => setCloneDialogOpen(false)}
              onClone={handleCloneVm}
              connId={connId}
              currentNode={node}
              vmName={data?.name || `VM ${vmid}`}
              vmid={vmid}
              nextVmid={Math.max(100, ...allVms.map(v => Number(v.vmid) || 0)) + 1}
              existingVmids={allVms.map(v => Number(v.vmid) || 0).filter(id => id > 0)}
              pools={[]}
            />
          </>
        )
      })()}
      
      {/* Dialog de migration depuis la table (hors du contexte VM sélectionnée) */}
      {tableMigrateVm && (
        <MigrateVmDialog
          open={!!tableMigrateVm}
          onClose={() => setTableMigrateVm(null)}
          onMigrate={handleTableMigrateVm}
          onCrossClusterMigrate={handleTableCrossClusterMigrate}
          connId={tableMigrateVm.connId}
          currentNode={tableMigrateVm.node}
          vmName={tableMigrateVm.name}
          vmid={tableMigrateVm.vmid}
          vmStatus={tableMigrateVm.status}
          vmType={tableMigrateVm.type as 'qemu' | 'lxc'}
          isCluster={tableMigrateVm.isCluster}
        />
      )}
      
      {/* Dialog de clonage depuis la table (hors du contexte VM sélectionnée) */}
      {tableCloneVm && (
        <CloneVmDialog
          open={!!tableCloneVm}
          onClose={() => setTableCloneVm(null)}
          onClone={handleTableCloneVm}
          connId={tableCloneVm.connId}
          currentNode={tableCloneVm.node}
          vmName={tableCloneVm.name}
          vmid={tableCloneVm.vmid}
          nextVmid={Math.max(100, ...allVms.map(v => Number(v.vmid) || 0)) + 1}
          existingVmids={allVms.map(v => Number(v.vmid) || 0).filter(id => id > 0)}
          pools={[]}
        />
      )}
      
      {/* Dialog d'édition d'option VM */}
      <Dialog open={!!editOptionDialog} onClose={() => setEditOptionDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-settings-3-line" style={{ fontSize: 20 }} />
          {t('common.edit')}: {editOptionDialog?.label}
        </DialogTitle>
        <DialogContent sx={{ pt: '20px !important' }}>
          <Box>
            {editOptionDialog?.type === 'text' && (
              <TextField
                fullWidth
                size="small"
                label={editOptionDialog.label}
                value={editOptionValue}
                onChange={(e) => setEditOptionValue(e.target.value)}
                multiline={editOptionDialog.key === 'description'}
                rows={editOptionDialog.key === 'description' ? 3 : 1}
                autoFocus
              />
            )}
            {editOptionDialog?.type === 'boolean' && (
              <FormControlLabel
                control={
                  <Switch 
                    checked={editOptionValue === true || editOptionValue === '1' || editOptionValue === 1}
                    onChange={(e) => setEditOptionValue(e.target.checked ? 1 : 0)}
                  />
                }
                label={editOptionDialog.label}
              />
            )}
            {editOptionDialog?.type === 'select' && editOptionDialog.options && (
              <FormControl fullWidth size="small">
                <InputLabel>{editOptionDialog.label}</InputLabel>
                <Select
                  value={editOptionValue}
                  onChange={(e) => setEditOptionValue(e.target.value)}
                  label={editOptionDialog.label}
                >
                  {editOptionDialog.options.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {editOptionDialog?.type === 'hotplug' && (() => {
              const fields = ['disk', 'network', 'usb', 'memory', 'cpu']
              const fieldLabels: Record<string, string> = { disk: 'Disk', network: 'Network', usb: 'USB', memory: 'Memory', cpu: 'CPU' }
              const raw = typeof editOptionValue === 'string' ? editOptionValue.toLowerCase() : ''
              const current = raw.split(',').map((s: string) => s.trim()).filter(Boolean)
              const toggle = (field: string) => {
                const next = current.includes(field) ? current.filter((f: string) => f !== field) : [...current, field]
                setEditOptionValue(next.join(','))
              }
              return (
                <Stack spacing={1}>
                  {fields.map(field => (
                    <FormControlLabel
                      key={field}
                      control={<Checkbox checked={current.includes(field)} onChange={() => toggle(field)} />}
                      label={fieldLabels[field] || field}
                    />
                  ))}
                </Stack>
              )
            })()}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditOptionDialog(null)} disabled={editOptionSaving}>{t('common.cancel')}</Button>
          <Button 
            variant="contained" 
            onClick={handleSaveOption}
            disabled={editOptionSaving}
            startIcon={editOptionSaving ? <CircularProgress size={16} /> : <i className="ri-save-line" />}
          >
            {editOptionSaving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog Créer/Modifier Groupe HA */}
      {selection?.type === 'cluster' && (
        <HaGroupDialog
          open={haGroupDialogOpen}
          onClose={() => {
            setHaGroupDialogOpen(false)
            setEditingHaGroup(null)
          }}
          group={editingHaGroup}
          connId={selection.id}
          availableNodes={data?.nodesData?.map((n: any) => n.node) || []}
          onSaved={() => {
            setHaGroupDialogOpen(false)
            setEditingHaGroup(null)
            loadClusterHa(selection.id)
          }}
        />
      )}

      {/* Dialog Supprimer Groupe HA */}
      <Dialog 
        open={!!deleteHaGroupDialog} 
        onClose={() => setDeleteHaGroupDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
          <i className="ri-delete-bin-line" style={{ fontSize: 20 }} />
          {t('drs.deleteHaGroup')}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {t('inventoryPage.deleteGroupConfirm')} <strong>{deleteHaGroupDialog?.group}</strong> ?
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('inventoryPage.resourcesWillBeDisassociated')}
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteHaGroupDialog(null)}>{t('common.cancel')}</Button>
          <Button 
            variant="contained" 
            color="error"
            onClick={async () => {
              if (!selection || !deleteHaGroupDialog) return

              try {
                const res = await fetch(
                  `/api/v1/connections/${encodeURIComponent(selection.id)}/ha/groups/${encodeURIComponent(deleteHaGroupDialog.group)}`,
                  { method: 'DELETE' }
                )

                if (!res.ok) {
                  const err = await res.json()

                  alert(err.error || t('errors.deleteError'))
                  
return
                }

                setDeleteHaGroupDialog(null)
                loadClusterHa(selection.id)
              } catch (e: any) {
                alert(e.message || t('errors.deleteError'))
              }
            }}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog Créer/Modifier Affinity Rule (PVE 9+) */}
      {selection?.type === 'cluster' && clusterPveMajorVersion >= 9 && (
        <HaRuleDialog
          open={haRuleDialogOpen}
          onClose={() => {
            setHaRuleDialogOpen(false)
            setEditingHaRule(null)
          }}
          rule={editingHaRule}
          ruleType={haRuleType}
          connId={selection.id}
          availableNodes={data?.nodesData || []}
          availableResources={clusterHaResources}
          allVms={allVms}
          onSaved={() => {
            setHaRuleDialogOpen(false)
            setEditingHaRule(null)
            loadClusterHa(selection.id)
          }}
        />
      )}

      {/* Dialog Supprimer Affinity Rule */}
      <Dialog 
        open={!!deleteHaRuleDialog} 
        onClose={() => setDeleteHaRuleDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
          <i className="ri-delete-bin-line" style={{ fontSize: 20 }} />
          {t('drs.deleteAffinityRule')}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {t('common.deleteConfirmation')} <strong>{deleteHaRuleDialog?.rule}</strong>?
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('common.warning')}
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteHaRuleDialog(null)}>{t('common.cancel')}</Button>
          <Button 
            variant="contained" 
            color="error"
            onClick={async () => {
              if (!selection || !deleteHaRuleDialog) return

              try {
                const res = await fetch(
                  `/api/v1/connections/${encodeURIComponent(selection.id)}/ha/affinity-rules/${encodeURIComponent(deleteHaRuleDialog.rule)}`,
                  { method: 'DELETE' }
                )

                if (!res.ok) {
                  const err = await res.json()

                  alert(err.error || t('errors.deleteError'))
                  
return
                }

                setDeleteHaRuleDialog(null)
                loadClusterHa(selection.id)
              } catch (e: any) {
                alert(e.message || t('errors.deleteError'))
              }
            }}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog de confirmation d'action VM */}
      <Dialog 
        open={!!confirmAction} 
        onClose={() => !confirmActionLoading && setConfirmAction(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {confirmAction?.action === 'stop' && <i className="ri-stop-circle-line" style={{ fontSize: 24, color: '#f44336' }} />}
          {confirmAction?.action === 'shutdown' && <i className="ri-shut-down-line" style={{ fontSize: 24, color: '#ff9800' }} />}
          {confirmAction?.action === 'suspend' && <i className="ri-pause-circle-line" style={{ fontSize: 24, color: '#2196f3' }} />}
          {confirmAction?.action === 'reboot' && <i className="ri-restart-line" style={{ fontSize: 24, color: '#ff9800' }} />}
          {confirmAction?.action === 'info' && <i className="ri-information-line" style={{ fontSize: 24, color: '#ff9800' }} />}
          {confirmAction?.action === 'delete-snapshot' && <i className="ri-delete-bin-line" style={{ fontSize: 24, color: '#f44336' }} />}
          {confirmAction?.action === 'restore-snapshot' && <i className="ri-history-line" style={{ fontSize: 24, color: '#ff9800' }} />}
          {confirmAction?.action === 'disable-ha' && <i className="ri-shield-cross-line" style={{ fontSize: 24, color: '#ff9800' }} />}
          {confirmAction?.title}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1 }}>
            <strong>{confirmAction?.vmName}</strong>
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.8, whiteSpace: 'pre-line' }}>
            {confirmAction?.message}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {confirmAction?.action !== 'info' && (
            <Button onClick={() => setConfirmAction(null)} disabled={confirmActionLoading}>
              {t('common.cancel')}
            </Button>
          )}
          <Button 
            variant="contained" 
            color={
              confirmAction?.action === 'stop' || confirmAction?.action === 'delete-snapshot' 
                ? 'error' 
                : confirmAction?.action === 'info' 
                  ? 'primary' 
                  : 'warning'
            }
            onClick={confirmAction?.onConfirm}
            disabled={confirmActionLoading}
            startIcon={confirmActionLoading ? <CircularProgress size={16} /> : null}
          >
            {confirmActionLoading ? t('common.loading') : confirmAction?.action === 'info' ? t('common.ok') : t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog de création de sauvegarde */}
      <Dialog
        open={createBackupDialogOpen}
        onClose={() => !creatingBackup && setCreateBackupDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-hard-drive-2-line" style={{ fontSize: 24 }} />
          {t('audit.actions.backup')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('backups.backupStorage')}</InputLabel>
              <Select
                value={backupStorage}
                onChange={(e) => setBackupStorage(e.target.value)}
                label={t('backups.backupStorage')}
              >
                {backupStorages.map((s) => (
                  <MenuItem key={s.storage} value={s.storage}>
                    {s.storage} ({s.type})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <FormControl fullWidth size="small">
              <InputLabel>{t('inventory.backupMode')}</InputLabel>
              <Select
                value={backupMode}
                onChange={(e) => setBackupMode(e.target.value as any)}
                label={t('inventory.backupMode')}
              >
                <MenuItem value="snapshot">{t('audit.actions.snapshot')}</MenuItem>
                <MenuItem value="suspend">{t('audit.actions.suspend')}</MenuItem>
                <MenuItem value="stop">{t('audit.actions.stop')}</MenuItem>
              </Select>
            </FormControl>
            
            <FormControl fullWidth size="small">
              <InputLabel>{t('inventory.backupCompression')}</InputLabel>
              <Select
                value={backupCompress}
                onChange={(e) => setBackupCompress(e.target.value as any)}
                label={t('inventory.backupCompression')}
              >
                <MenuItem value="zstd">{t('inventoryPage.zstdRecommended')}</MenuItem>
                <MenuItem value="lzo">{t('inventoryPage.lzoFast')}</MenuItem>
                <MenuItem value="gzip">{t('inventory.backupGzip')}</MenuItem>
                <MenuItem value="none">{t('common.none')}</MenuItem>
              </Select>
            </FormControl>
            
            <TextField
              fullWidth
              size="small"
              label={t('inventoryPage.noteOptional')}
              value={backupNote}
              onChange={(e) => setBackupNote(e.target.value)}
              multiline
              rows={2}
            />
            
            {data?.vmRealStatus === 'running' && backupMode === 'stop' && (
              <Alert severity="warning">
                {t('common.warning')}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreateBackupDialogOpen(false)} disabled={creatingBackup}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={creatingBackup || !backupStorage}
            onClick={async () => {
              if (!selection || selection.type !== 'vm' || !backupStorage) return
              
              const { connId, node, type, vmid } = parseVmId(selection.id)
              
              setCreatingBackup(true)

              try {
                const params: Record<string, any> = {
                  storage: backupStorage,
                  mode: backupMode,
                  compress: backupCompress,
                  vmid: vmid,
                }

                if (backupNote) params.notes = backupNote
                
                const res = await fetch(
                  `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/vzdump`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params)
                  }
                )
                
                if (!res.ok) {
                  const err = await res.json().catch(() => ({}))

                  throw new Error(err?.error || `HTTP ${res.status}`)
                }
                
                setCreateBackupDialogOpen(false)
                alert(t('backups.backupStarted'))
                
                // Recharger les backups après un délai
                setTimeout(() => {
                  if (selection?.type === 'vm') {
                    const { type: vmType, vmid } = parseVmId(selection.id)

                    loadBackups(vmid, vmType)
                  }
                }, 5000)
              } catch (e: any) {
                alert(`${t('common.error')}: ${e?.message || e}`)
              } finally {
                setCreatingBackup(false)
              }
            }}
            startIcon={creatingBackup ? <CircularProgress size={16} /> : <i className="ri-save-line" />}
          >
            {creatingBackup ? t('common.loading') : t('common.create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog de suppression de VM */}
      <Dialog
        open={deleteVmDialogOpen}
        onClose={() => !deletingVm && setDeleteVmDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
          <i className="ri-delete-bin-line" style={{ fontSize: 24 }} />
          {t('inventory.deleteVm')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 3 }}>
            <Typography variant="body2" fontWeight={600}>
              {t('common.warning')}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {t('common.deleteConfirmation')}
            </Typography>
          </Alert>

          <Box sx={{ mb: 3, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
            <Typography variant="body2" sx={{ opacity: 0.7 }}>{t('common.delete')}:</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {data?.title || 'VM'} <Typography component="span" variant="body2" sx={{ opacity: 0.6 }}>(ID: {selection?.type === 'vm' ? parseVmId(selection.id).vmid : ''})</Typography>
            </Typography>
          </Box>
          
          <FormControlLabel
            control={
              <Switch
                checked={deleteVmPurge}
                onChange={(e) => setDeleteVmPurge(e.target.checked)}
              />
            }
            label={t('inventory.deleteVmDisks')}
            sx={{ mb: 3 }}
          />
          
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t('common.confirm')}: <strong>{selection?.type === 'vm' ? parseVmId(selection.id).vmid : ''}</strong> / <strong>{data?.title}</strong>
          </Typography>
          <TextField
            fullWidth
            size="small"
            placeholder={`${selection?.type === 'vm' ? parseVmId(selection.id).vmid : ''} / ${data?.title}`}
            value={deleteVmConfirmText}
            onChange={(e) => setDeleteVmConfirmText(e.target.value)}
            error={deleteVmConfirmText !== '' && deleteVmConfirmText !== (selection?.type === 'vm' ? parseVmId(selection.id).vmid : '') && deleteVmConfirmText !== data?.title}
            autoFocus
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteVmDialogOpen(false)} disabled={deletingVm}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={
              deletingVm || 
              (deleteVmConfirmText !== (selection?.type === 'vm' ? parseVmId(selection.id).vmid : '') && 
               deleteVmConfirmText !== data?.title)
            }
            onClick={handleDeleteVm}
            startIcon={deletingVm ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" />}
          >
            {deletingVm ? t('common.deleting') : t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog de conversion en template */}
      <Dialog
        open={convertTemplateDialogOpen}
        onClose={() => !convertingTemplate && setConvertTemplateDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-file-text-line" style={{ fontSize: 24 }} />
          {t('templates.convertToTemplate')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" fontWeight={600}>
              {t('templates.convertWarning')}
            </Typography>
          </Alert>
          <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
            <Typography variant="body2" sx={{ opacity: 0.7 }}>VM:</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {data?.title || 'VM'} <Typography component="span" variant="body2" sx={{ opacity: 0.6 }}>(ID: {selection?.type === 'vm' ? parseVmId(selection.id).vmid : ''})</Typography>
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConvertTemplateDialogOpen(false)} disabled={convertingTemplate}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleConvertTemplate}
            disabled={convertingTemplate}
            startIcon={convertingTemplate ? <CircularProgress size={16} /> : <i className="ri-file-text-line" />}
          >
            {convertingTemplate ? t('common.loading') : t('templates.convert')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog d'erreur Unlock */}
      {unlockErrorDialog.open && (
        <Dialog
          open={true}
          onClose={() => setUnlockErrorDialog({ open: false, error: '' })}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-error-warning-line" style={{ fontSize: 24, color: '#f59e0b' }} />
            {t('inventory.unlockError')}
          </DialogTitle>
          <DialogContent>
            <Alert severity="warning" sx={{ mb: 2 }}>
              {unlockErrorDialog.error}
            </Alert>
            {unlockErrorDialog.hint && (
              <Box sx={{
                bgcolor: 'action.hover',
                borderRadius: 1,
                p: 2,
                fontFamily: 'monospace',
                fontSize: 14
              }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  {t('inventory.unlockHint')}
                </Typography>
                <code style={{
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  padding: '4px 8px',
                  borderRadius: 4,
                  userSelect: 'all'
                }}>
                  {unlockErrorDialog.hint}
                </code>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setUnlockErrorDialog({ open: false, error: '' })}>
              {t('common.close')}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Dialog de confirmation pour les bulk actions */}
      <Dialog
        open={bulkActionDialog.open}
        onClose={() => setBulkActionDialog({ open: false, action: null, node: null, targetNode: '' })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {bulkActionDialog.action === 'start-all' && (
            <><PlayArrowIcon sx={{ color: 'success.main' }} />{t('bulkActions.startAllVms')}</>
          )}
          {bulkActionDialog.action === 'shutdown-all' && (
            <><PowerSettingsNewIcon sx={{ color: 'warning.main' }} />{t('bulkActions.shutdownAllVms')}</>
          )}
          {bulkActionDialog.action === 'stop-all' && (
            <><StopIcon sx={{ color: 'error.main' }} />{t('bulkActions.stopAllVms')}</>
          )}
          {bulkActionDialog.action === 'migrate-all' && (
            <><MoveUpIcon sx={{ color: 'primary.main' }} />{t('bulkActions.migrateAllVms')}</>
          )}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('common.node')}: <strong>{bulkActionDialog.node?.name}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              VMs: <strong>{bulkActionDialog.node?.vms ?? 0}</strong>
            </Typography>
          </Box>

          {bulkActionDialog.action === 'start-all' && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('bulkActions.confirmStartAll')}
            </Alert>
          )}
          {bulkActionDialog.action === 'shutdown-all' && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('bulkActions.confirmShutdownAll')}
            </Alert>
          )}
          {bulkActionDialog.action === 'stop-all' && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {t('bulkActions.confirmStopAll')}
            </Alert>
          )}
          {bulkActionDialog.action === 'migrate-all' && (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('bulkActions.confirmMigrateAll')}
              </Alert>
              <FormControl fullWidth size="small" sx={{ mt: 2 }}>
                <InputLabel>{t('bulkActions.targetNode')}</InputLabel>
                <Select
                  value={bulkActionDialog.targetNode}
                  label={t('bulkActions.targetNode')}
                  onChange={(e) => setBulkActionDialog(prev => ({ ...prev, targetNode: e.target.value }))}
                >
                  {(data?.nodesData || [])
                    .filter((n: any) => n.node !== bulkActionDialog.node?.name && n.status === 'online')
                    .map((n: any) => (
                      <MenuItem key={n.node} value={n.node}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                            <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 14, height: 14, opacity: 0.8 }} />
                            <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: 'success.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                          </Box>
                          {n.node}
                        </Box>
                      </MenuItem>
                    ))
                  }
                </Select>
              </FormControl>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setBulkActionDialog({ open: false, action: null, node: null, targetNode: '' })}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color={
              bulkActionDialog.action === 'start-all' ? 'success' :
              bulkActionDialog.action === 'stop-all' ? 'error' :
              bulkActionDialog.action === 'shutdown-all' ? 'warning' : 'primary'
            }
            onClick={executeBulkAction}
            disabled={bulkActionDialog.action === 'migrate-all' && !bulkActionDialog.targetNode}
          >
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ESXi / XCP-ng Migration Dialog */}
      <Dialog open={!!esxiMigrateVm} onClose={() => { if (!migStarting) setEsxiMigrateVm(null) }} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <img src={esxiMigrateVm?.hostType === 'nutanix' ? '/images/nutanix-logo.svg' : esxiMigrateVm?.hostType === 'hyperv' ? '/images/hyperv-logo.svg' : esxiMigrateVm?.hostType === 'xcpng' ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'} alt="" width={22} height={22} />
          {t('inventoryPage.esxiMigration.migrateToProxmox')}
        </DialogTitle>
        <DialogContent>
          {esxiMigrateVm && !migJobId && (
            <Stack spacing={2.5} sx={{ mt: 1 }}>
              {/* Source VM info */}
              <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('inventoryPage.esxiMigration.sourceVm')}</Typography>
                <Typography variant="body1" fontWeight={600}>{esxiMigrateVm.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {esxiMigrateVm.connName} — {esxiMigrateVm.cpu || '?'} vCPU · {esxiMigrateVm.memoryMB ? (esxiMigrateVm.memoryMB / 1024).toFixed(1) : '?'} GB RAM
                  {esxiMigrateVm.committed ? ` · ${(esxiMigrateVm.committed / 1073741824).toFixed(1)} GB disk` : ''}
                </Typography>
              </Box>

              {/* Arrow */}
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <i className="ri-arrow-down-line" style={{ fontSize: 24, color: theme.palette.primary.main }} />
              </Box>

              {/* Target config */}
              <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('inventoryPage.esxiMigration.targetProxmox')}</Typography>
                <Stack spacing={2}>
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('inventoryPage.esxiMigration.targetNode')}</InputLabel>
                    <Select
                      value={migTargetConn && migTargetNode ? `${migTargetConn}::${migTargetNode}` : ''}
                      onChange={e => {
                        const val = e.target.value as string
                        const [connId, node] = val.split('::')
                        setMigTargetConn(connId || '')
                        setMigTargetNode(node || '')
                        setMigTargetStorage('')
                        setMigNetworkBridge('')
                      }}
                      label={t('inventoryPage.esxiMigration.targetNode')}
                      renderValue={(val) => {
                        const [connId, node] = (val as string).split('::')
                        const conn = migPveConnections.find((c: any) => c.id === connId)
                        const opt = migNodeOptions.find((o: any) => o.connId === connId && o.node === node)
                        const isCluster = conn?.hosts?.length > 1
                        const isDarkRv = theme.palette.mode === 'dark'
                        if (!conn) return ''
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                              <img src={isDarkRv ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                              <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: opt?.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                            </Box>
                            <Typography variant="body2" fontWeight={500}>{isCluster ? `${node} (${conn.name})` : conn.name}</Typography>
                          </Box>
                        )
                      }}
                    >
                      {migPveConnections.map((conn: any, connIdx: number) => {
                        const isCluster = conn.hosts?.length > 1
                        const isDark = theme.palette.mode === 'dark'
                        const connNodes = migNodeOptions.filter((o: any) => o.connId === conn.id)
                        const items: React.ReactNode[] = []
                        if (connIdx > 0) items.push(<Divider key={`div-${conn.id}`} />)
                        if (isCluster) {
                          // Cluster: header + indented nodes
                          items.push(
                            <MenuItem key={`header-${conn.id}`} disabled sx={{ opacity: '1 !important', py: 0.5, minHeight: 32, bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                <i className="ri-server-fill" style={{ fontSize: 14, opacity: 0.8 }} />
                                <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10, color: 'text.secondary' }}>
                                  {conn.name}
                                </Typography>
                                <Chip size="small" label="Cluster" sx={{ height: 16, fontSize: 9, fontWeight: 600 }} />
                              </Box>
                            </MenuItem>
                          )
                          connNodes.forEach((node: any) => {
                            items.push(
                              <MenuItem key={`${conn.id}::${node.node}`} value={`${conn.id}::${node.node}`} sx={{ pl: 4 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                  <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                    <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                                    <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: node.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                                  </Box>
                                  <Typography variant="body2" fontWeight={500}>{node.node}</Typography>
                                  {node.ip && <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>{node.ip}</Typography>}
                                </Box>
                              </MenuItem>
                            )
                          })
                        } else {
                          // Standalone: single selectable row with connection name
                          const node = connNodes[0]
                          if (node) {
                            items.push(
                              <MenuItem key={`${conn.id}::${node.node}`} value={`${conn.id}::${node.node}`}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                  <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                    <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                                    <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: node.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                                  </Box>
                                  <Typography variant="body2" fontWeight={500}>{conn.name}</Typography>
                                  {node.ip && <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>{node.ip}</Typography>}
                                </Box>
                              </MenuItem>
                            )
                          }
                        }
                        return items
                      })}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth size="small" disabled={!migTargetNode || migStorages.length === 0}>
                    <InputLabel>{t('inventoryPage.esxiMigration.targetStorage')}</InputLabel>
                    <Select
                      value={migTargetStorage}
                      onChange={e => setMigTargetStorage(e.target.value)}
                      label={t('inventoryPage.esxiMigration.targetStorage')}
                      renderValue={(val) => {
                        const s = migStorages.find((s: any) => s.storage === val)
                        if (!s) return ''
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.7 }} />
                            <Typography variant="body2" fontWeight={500}>{s.storage}</Typography>
                            <Typography variant="caption" sx={{ opacity: 0.5 }}>({s.type})</Typography>
                          </Box>
                        )
                      }}
                    >
                      {migStorages.map((s: any) => {
                        const usedPct = s.total && s.avail ? Math.round(((s.total - s.avail) / s.total) * 100) : 0
                        return (
                          <MenuItem key={s.storage} value={s.storage}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                              <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.7 }} />
                              <Typography variant="body2" fontWeight={500}>{s.storage}</Typography>
                              <Typography variant="caption" sx={{ opacity: 0.5 }}>({s.type})</Typography>
                              <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 100 }}>
                                <Box sx={{ flex: 1, height: 4, bgcolor: 'action.hover', borderRadius: 0, overflow: 'hidden' }}>
                                  <Box sx={{ height: '100%', width: `${usedPct}%`, bgcolor: usedPct > 85 ? 'error.main' : usedPct > 60 ? 'warning.main' : 'success.main', transition: 'width 0.3s' }} />
                                </Box>
                                <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6, whiteSpace: 'nowrap' }}>
                                  {s.avail ? `${(s.avail / 1073741824).toFixed(1)} GB` : ''}
                                </Typography>
                              </Box>
                            </Box>
                          </MenuItem>
                        )
                      })}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth size="small" disabled={!migTargetNode || migBridges.length === 0}>
                    <InputLabel>{t('inventoryPage.esxiMigration.networkBridge')}</InputLabel>
                    <Select
                      value={migNetworkBridge}
                      onChange={e => setMigNetworkBridge(e.target.value)}
                      label={t('inventoryPage.esxiMigration.networkBridge')}
                      renderValue={(val) => {
                        const b = migBridges.find((b: any) => b.iface === val)
                        if (!b) return ''
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-router-line" style={{ fontSize: 14, opacity: 0.7 }} />
                            <Typography variant="body2" fontWeight={500}>{b.iface}</Typography>
                            {b.comments && <Typography variant="caption" sx={{ opacity: 0.5 }}>({b.comments})</Typography>}
                          </Box>
                        )
                      }}
                    >
                      {migBridges.map((b: any) => (
                        <MenuItem key={b.iface} value={b.iface}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                            <i className="ri-router-line" style={{ fontSize: 14, opacity: 0.7 }} />
                            <Typography variant="body2" fontWeight={500}>{b.iface}</Typography>
                            {b.comments && <Typography variant="caption" sx={{ opacity: 0.5 }}>({b.comments})</Typography>}
                            {b.cidr && <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>{b.cidr}</Typography>}
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {/* Migration type selector — hidden for Hyper-V / Nutanix (cold only).
                      vCenter supports cold + live (via NFC-on-snapshot); direct ESXi
                      additionally supports sshfs_boot. */}
                  {esxiMigrateVm?.hostType !== 'hyperv' && esxiMigrateVm?.hostType !== 'nutanix' && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 0.75, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {t('inventoryPage.esxiMigration.migrationType')}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      {([
                        { value: 'cold' as const, icon: 'ri-shut-down-line', color: 'info.main', labelKey: 'migrationTypeCold', descKey: 'migrationTypeColdDesc' },
                        { value: 'live' as const, icon: 'ri-flashlight-line', color: 'success.main', labelKey: 'migrationTypeLive', descKey: 'migrationTypeLiveDesc' },
                        { value: 'sshfs_boot' as const, icon: 'ri-speed-line', color: 'warning.main', labelKey: 'migrationTypeSshfsBoot', descKey: 'migrationTypeSshfsBootDesc' },
                      ]).filter(opt => esxiMigrateVm?.hostType !== 'vcenter' || opt.value !== 'sshfs_boot').map(opt => (
                        <MuiTooltip key={opt.value} title={t(`inventoryPage.esxiMigration.${opt.descKey}`)} arrow placement="top">
                          <Box
                            onClick={() => setMigType(opt.value)}
                            sx={{
                              flex: 1, py: 1, px: 1.5, borderRadius: 1.5, border: '2px solid', cursor: 'pointer', transition: 'all 0.15s',
                              borderColor: migType === opt.value ? `${opt.color}` : 'divider',
                              bgcolor: migType === opt.value ? (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)') : 'transparent',
                              '&:hover': { borderColor: `${opt.color}` },
                              display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center',
                            }}
                          >
                            <i className={opt.icon} style={{ fontSize: 16, color: migType === opt.value ? theme.palette[opt.color.split('.')[0] as 'info' | 'success' | 'warning'].main : undefined, opacity: migType === opt.value ? 1 : 0.6 }} />
                            <Typography variant="body2" fontWeight={migType === opt.value ? 700 : 500} fontSize={12} noWrap>
                              {t(`inventoryPage.esxiMigration.${opt.labelKey}`)}
                            </Typography>
                          </Box>
                        </MuiTooltip>
                      ))}
                    </Stack>
                  </Box>
                  )}

                  {/* Transfer mode selector — hidden for vCenter (virt-v2v handles transfer) */}
                  {esxiMigrateVm?.hostType !== 'vcenter' && esxiMigrateVm?.hostType !== 'hyperv' && esxiMigrateVm?.hostType !== 'nutanix' && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 0.75, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {t('inventoryPage.esxiMigration.transferMode')}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      {([
                        { value: 'sshfs' as const, icon: 'ri-folder-shared-line', color: 'warning.main', labelKey: 'transferModeSshfs', descKey: 'transferModeSshfsDesc' },
                        { value: 'https' as const, icon: 'ri-download-cloud-line', color: 'info.main', labelKey: 'transferModeHttps', descKey: 'transferModeHttpsDesc' },
                      ]).map(opt => (
                        <MuiTooltip key={opt.value} title={t(`inventoryPage.esxiMigration.${opt.descKey}`)} arrow placement="top">
                          <Box
                            onClick={() => setMigTransferMode(opt.value)}
                            sx={{
                              flex: 1, py: 1, px: 1.5, borderRadius: 1.5, border: '2px solid', cursor: 'pointer', transition: 'all 0.15s',
                              borderColor: migTransferMode === opt.value ? `${opt.color}` : 'divider',
                              bgcolor: migTransferMode === opt.value ? (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)') : 'transparent',
                              '&:hover': { borderColor: `${opt.color}` },
                              display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center',
                            }}
                          >
                            <i className={opt.icon} style={{ fontSize: 16, color: migTransferMode === opt.value ? theme.palette[opt.color.split('.')[0] as 'warning' | 'info'].main : undefined, opacity: migTransferMode === opt.value ? 1 : 0.6 }} />
                            <Typography variant="body2" fontWeight={migTransferMode === opt.value ? 700 : 500} fontSize={12} noWrap>
                              {t(`inventoryPage.esxiMigration.${opt.labelKey}`)}
                            </Typography>
                          </Box>
                        </MuiTooltip>
                      ))}
                    </Stack>
                  </Box>
                  )}

                  {/* sshfs not installed warning */}
                  {esxiMigrateVm?.hostType !== 'vcenter' && esxiMigrateVm?.hostType !== 'hyperv' && esxiMigrateVm?.hostType !== 'nutanix' && migSshfsAvailable === false && (migTransferMode === 'sshfs' || migType === 'sshfs_boot') && (
                    <Alert severity="warning" sx={{ fontSize: 12 }} icon={<i className="ri-folder-shared-line" style={{ fontSize: 18 }} />}>
                      {t('inventoryPage.esxiMigration.sshfsNotInstalled')}
                    </Alert>
                  )}

                  {/*
                    v2v dependency checklist — shown for vCenter/Hyper-V/Nutanix sources.
                    Every required apt package that the v2v pipeline shells out to at
                    some phase gets its own line with a green ✓ or red ✗. The Install
                    button is a single action that apt-installs the whole bundle
                    (installV2vPackages on the backend), so we show it whenever ANY
                    required dep is missing. The Start Migration button in the footer
                    is gated on the same condition via the isV2vDepsSatisfied derived
                    below — deps missing -> button disabled.
                  */}
                  {(esxiMigrateVm?.hostType === 'vcenter' || esxiMigrateVm?.hostType === 'hyperv' || esxiMigrateVm?.hostType === 'nutanix') && vcenterPreflight?.checked && (() => {
                    const isWindowsGuest = !!esxiMigrateVm?.guestOS?.toLowerCase().includes('win')
                    // Describe the scope of the preflight check so the user understands
                    // that the dep status is aggregated across ALL nodes the batch
                    // could land on when Auto is selected, not just a single node.
                    const isAuto = migTargetNode === '__auto__'
                    const checkedNodes = isAuto
                      ? migNodeOptions.filter((o: any) => o.connId === migTargetConn && o.status === 'online').length
                      : 1
                    const scopeLabel = isAuto ? `all ${checkedNodes} online nodes of the cluster` : 'the target node'
                    // Split the dep list into "apt-installable" (what the Install button
                    // covers) and "manual" (virtio-win — a proprietary Red Hat ISO not
                    // packaged in Debian repos, the user must fetch it themselves). The
                    // button only handles the apt-installable bucket; virtio-win gets
                    // its own instruction block with the copy-pasteable curl command.
                    const aptChecklist = [
                      { label: 'virt-v2v', installed: vcenterPreflight.virtV2vInstalled, required: true, note: 'VM OS conversion + driver injection' },
                      { label: 'nbdkit', installed: vcenterPreflight.nbdkitInstalled, required: true, note: 'needed by virt-v2v -i disk on vSAN VMs' },
                      { label: 'libnbd-bin (nbdcopy)', installed: vcenterPreflight.nbdcopyInstalled, required: true, note: 'virt-v2v disk copy step' },
                      { label: 'guestfs-tools (rhsrvany)', installed: vcenterPreflight.guestfsToolsInstalled, required: true, note: 'Windows firstboot scripts' },
                      { label: 'ovmf', installed: vcenterPreflight.ovmfInstalled, required: true, note: 'UEFI firmware for output metadata' },
                    ]
                    const virtioWinMissing = !vcenterPreflight.virtioWinInstalled
                    const virtioWinRequired = isWindowsGuest
                    const missingApt = aptChecklist.some(d => !d.installed)
                    const allAptOk = !missingApt
                    const allOk = allAptOk && (!virtioWinRequired || !virtioWinMissing)
                    if (allOk) {
                      return (
                        <Alert severity="success" sx={{ fontSize: 12 }} icon={<i className="ri-checkbox-circle-line" style={{ fontSize: 18 }} />}>
                          All virt-v2v dependencies are installed on {scopeLabel}.
                        </Alert>
                      )
                    }
                    // Build the full checklist for display (apt + virtio-win info line).
                    const checklist: { label: string; installed: boolean; required: boolean; note?: string; manual?: boolean }[] = [
                      ...aptChecklist,
                      { label: 'virtio-win ISO', installed: vcenterPreflight.virtioWinInstalled, required: virtioWinRequired, note: virtioWinRequired ? 'Windows guest drivers — MANUAL install' : 'Windows guest drivers (not needed for Linux VMs)', manual: true },
                    ]
                    return (
                      <>
                      {missingApt && <Alert
                        severity="warning"
                        sx={{ fontSize: 12, '& .MuiAlert-message': { width: '100%' } }}
                        icon={<i className="ri-tools-line" style={{ fontSize: 18 }} />}
                      >
                        <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                          {isAuto
                            ? `At least one node in the cluster is missing required migration tools (checked ${checkedNodes} online nodes)`
                            : 'Target node is missing required migration tools'}
                        </Typography>
                        <Box component="ul" sx={{ m: 0, pl: 2, mb: 1 }}>
                          {checklist.map(dep => (
                            <Box
                              component="li"
                              key={dep.label}
                              sx={{
                                listStyle: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                fontSize: 11,
                                py: 0.25,
                                opacity: dep.required ? 1 : 0.7,
                              }}
                            >
                              {dep.installed ? (
                                <i className="ri-checkbox-circle-fill" style={{ fontSize: 14, color: '#2e7d32' }} />
                              ) : (
                                <i className="ri-close-circle-fill" style={{ fontSize: 14, color: dep.required ? '#d32f2f' : '#ed6c02' }} />
                              )}
                              <span><strong>{dep.label}</strong>{dep.note ? <span style={{ opacity: 0.6 }}> — {dep.note}</span> : null}{!dep.required ? <span style={{ opacity: 0.6 }}> (optional)</span> : null}</span>
                            </Box>
                          ))}
                        </Box>
                        <Button
                          size="small"
                          color="warning"
                          variant="contained"
                          disabled={vcenterPreflight.installing}
                          startIcon={vcenterPreflight.installing ? <CircularProgress size={14} color="inherit" /> : <i className="ri-download-line" />}
                          onClick={async () => {
                            setVcenterPreflight(prev => prev ? { ...prev, installing: true } : prev)
                            try {
                              // Install target = every online node of the cluster when Auto
                              // is selected, otherwise just the single chosen node. apt-get
                              // is idempotent so re-installing on nodes that already have
                              // the deps is a no-op. We run in parallel for speed.
                              // NOTE: apt-install only covers virt-v2v + nbdkit + libnbd-bin.
                              // virtio-win is a separate ISO the user must fetch manually
                              // (see the instructions block below). Don't mix them here.
                              const installNodes = migTargetNode === '__auto__'
                                ? migNodeOptions.filter((o: any) => o.connId === migTargetConn && o.status === 'online').map((o: any) => o.node)
                                : [migTargetNode]
                              await Promise.all(installNodes.map((node: string) => fetch('/api/v1/migrations/preflight', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: node, action: 'install' }),
                              })))
                              // Re-check across the same node set and aggregate (AND semantics).
                              const results = await Promise.all(installNodes.map(async (node: string) => {
                                const r2 = await fetch('/api/v1/migrations/preflight', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: node }),
                                })
                                return r2.json()
                              }))
                              const allVirtV2v = results.every((r: any) => !!r.virtV2vInstalled)
                              const allNbdkit = results.every((r: any) => !!r.nbdkitInstalled)
                              const allNbdcopy = results.every((r: any) => !!r.nbdcopyInstalled)
                              const allGuestfsTools = results.every((r: any) => !!r.guestfsToolsInstalled)
                              const allOvmf = results.every((r: any) => !!r.ovmfInstalled)
                              const allVirtioWin = results.every((r: any) => !!r.virtioWinInstalled)
                              const firstWithDisks = results.find((r: any) => r.detectedDisks && r.detectedDisks.length > 0)
                              const firstWithStorages = results[0]
                              setVcenterPreflight({
                                checked: true,
                                ok: results.every((r: any) => !(r.errors || []).length),
                                installing: false,
                                errors: [],
                                virtV2vInstalled: allVirtV2v,
                                virtioWinInstalled: allVirtioWin,
                                nbdkitInstalled: allNbdkit,
                                nbdcopyInstalled: allNbdcopy,
                                guestfsToolsInstalled: allGuestfsTools,
                                ovmfInstalled: allOvmf,
                                detectedDisks: firstWithDisks?.detectedDisks || [],
                                tempStorages: firstWithStorages?.tempStorages || [],
                              })
                            } catch {
                              setVcenterPreflight(prev => prev ? { ...prev, installing: false } : prev)
                            }
                          }}
                          sx={{ textTransform: 'none', fontSize: 11, whiteSpace: 'nowrap' }}
                        >
                          {vcenterPreflight.installing
                            ? (migTargetNode === '__auto__' ? `Installing on ${migNodeOptions.filter((o: any) => o.connId === migTargetConn && o.status === 'online').length} nodes…` : 'Installing on target node…')
                            : 'Install missing packages'}
                        </Button>
                      </Alert>}
                      {/* Manual virtio-win instruction block. We hide it entirely
                          for Linux guests (isWindowsGuest is derived from the VM's
                          Guest OS string that vSphere/the hypervisor returned) so
                          the modal doesn't show irrelevant instructions for a VM
                          the user is migrating as Linux. For Windows guests we
                          surface the copy-paste command because the ISO is a
                          proprietary Red Hat ISO (not in Debian repos) that we
                          intentionally don't auto-fetch. Informational only, the
                          Start Migration button is not blocked on this. */}
                      {virtioWinMissing && virtioWinRequired && (
                        <Alert severity="info" sx={{ fontSize: 11, mt: 1, '& .MuiAlert-message': { width: '100%' } }} icon={<i className="ri-windows-line" style={{ fontSize: 18 }} />}>
                          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                            virtio-win ISO (Windows guest detected)
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1, fontSize: 11 }}>
                            Windows VirtIO drivers (storage + network) required for VM to boot after conversion.
                          </Typography>
                          {virtioWinProgress ? (
                            <Box>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                <Typography variant="caption" sx={{ fontSize: 10 }}>
                                  Downloading virtio-win.iso… {(virtioWinProgress.sizeBytes / 1048576).toFixed(0)} MB
                                </Typography>
                                <Typography variant="caption" fontWeight={700} sx={{ fontSize: 10 }}>
                                  {virtioWinProgress.percent}%
                                </Typography>
                              </Box>
                              <LinearProgress variant="determinate" value={virtioWinProgress.percent} sx={{ height: 6, borderRadius: 1 }} />
                            </Box>
                          ) : (
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<i className="ri-download-2-line" />}
                              onClick={startVirtioWinDownload}
                              sx={{ textTransform: 'none', fontSize: 11 }}
                            >
                              Download virtio-win ISO (~700 MB)
                            </Button>
                          )}
                        </Alert>
                      )}
                      </>
                    )
                  })()}

                  {/* Temporary storage for virt-v2v */}
                  {(esxiMigrateVm?.hostType === 'vcenter' || esxiMigrateVm?.hostType === 'hyperv' || esxiMigrateVm?.hostType === 'nutanix') && vcenterPreflight?.tempStorages && vcenterPreflight.tempStorages.length > 0 && (
                    <Box>
                      <TextField
                        select
                        fullWidth
                        size="small"
                        label="Temporary Storage"
                        value={migTempStorage}
                        onChange={(e) => setMigTempStorage(e.target.value)}
                        helperText={(() => {
                          const sel = vcenterPreflight.tempStorages.find(s => s.path === migTempStorage)
                          const vmDiskBytes = esxiMigrateVm?.committed || 0
                          const requiredBytes = vmDiskBytes * 2 // source + converted
                          if (!sel) return 'Select where virt-v2v writes temporary files during conversion'
                          const availGB = (sel.availableBytes / 1073741824).toFixed(1)
                          const reqGB = (requiredBytes / 1073741824).toFixed(1)
                          if (sel.availableBytes < requiredBytes) return `Insufficient space: ${availGB} GB available, ~${reqGB} GB required`
                          return `${availGB} GB available (${sel.filesystem})`
                        })()}
                        error={(() => {
                          const sel = vcenterPreflight.tempStorages.find(s => s.path === migTempStorage)
                          const vmDiskBytes = esxiMigrateVm?.committed || 0
                          return sel ? sel.availableBytes < vmDiskBytes * 2 : false
                        })()}
                      >
                        {vcenterPreflight.tempStorages.map(s => {
                          const usedPct = Math.round(((s.totalBytes - s.availableBytes) / s.totalBytes) * 100)
                          const availGB = (s.availableBytes / 1073741824).toFixed(1)
                          const totalGB = (s.totalBytes / 1073741824).toFixed(1)
                          return (
                            <MenuItem key={s.path} value={s.path}>
                              <Box sx={{ width: '100%' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                  <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.5 }} />
                                  <Typography variant="body2" sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}>{s.path}</Typography>
                                  <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>
                                    {availGB} / {totalGB} GB free
                                  </Typography>
                                </Box>
                                <LinearProgress
                                  variant="determinate"
                                  value={usedPct}
                                  sx={{
                                    height: 4,
                                    borderRadius: 2,
                                    bgcolor: 'action.hover',
                                    '& .MuiLinearProgress-bar': {
                                      bgcolor: usedPct > 90 ? 'error.main' : usedPct > 70 ? 'warning.main' : 'success.main',
                                      borderRadius: 2,
                                    }
                                  }}
                                />
                              </Box>
                            </MenuItem>
                          )
                        })}
                      </TextField>
                    </Box>
                  )}

                  {/* Disk paths for Hyper-V */}
                  {esxiMigrateVm?.hostType === 'hyperv' && (
                    <Box>
                      <Typography variant="caption" sx={{ fontWeight: 600, mb: 0.5, display: 'block' }}>VHDX Disks</Typography>
                      {esxiMigrateVm.diskPaths && esxiMigrateVm.diskPaths.length > 0 ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          {esxiMigrateVm.diskPaths.map((disk: string) => {
                            const fileName = disk.split('\\').pop() || disk.split('/').pop() || disk
                            return (
                              <Box key={disk} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.75, borderRadius: 1, bgcolor: 'action.hover' }}>
                                <i className="ri-checkbox-circle-fill" style={{ fontSize: 16, color: theme.palette.success.main }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography variant="body2" sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, wordBreak: 'break-all' }}>
                                    /mnt/hyperv/{fileName}
                                  </Typography>
                                  <Typography variant="caption" sx={{ opacity: 0.4, fontSize: 10 }}>
                                    {disk}
                                  </Typography>
                                </Box>
                              </Box>
                            )
                          })}
                          <Typography variant="caption" sx={{ opacity: 0.5, mt: 0.25 }}>
                            SMB share will be mounted automatically during migration
                          </Typography>
                        </Box>
                      ) : (
                        <TextField
                          fullWidth
                          size="small"
                          label="VHDX Disk Paths"
                          value={migDiskPaths}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMigDiskPaths(e.target.value)}
                          multiline
                          rows={3}
                          placeholder={"/mnt/hyperv/vm-disk1.vhdx"}
                          helperText="One path per line. SMB share will be mounted automatically."
                          slotProps={{ input: { sx: { fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem' } } }}
                        />
                      )}
                    </Box>
                  )}

                  <FormControlLabel
                    control={<Switch size="small" checked={migStartAfter} onChange={(_, v) => setMigStartAfter(v)} />}
                    label={<Typography variant="body2">{t('inventoryPage.esxiMigration.startAfterMigration')}</Typography>}
                  />
                </Stack>
              </Box>

              {/* SSH warning — not needed for vCenter (virt-v2v handles connection) */}
              {esxiMigrateVm?.hostType !== 'vcenter' && esxiMigrateVm?.hostType !== 'hyperv' && esxiMigrateVm?.hostType !== 'nutanix' && migTargetConn && (() => {
                const selectedConn = migPveConnections.find((c: any) => c.id === migTargetConn)
                return selectedConn && !selectedConn.sshEnabled ? (
                  <Alert severity="warning" sx={{ fontSize: 12 }} icon={<i className="ri-ssh-line" style={{ fontSize: 18 }} />}>
                    {t('inventoryPage.esxiMigration.sshRequired')}
                  </Alert>
                ) : null
              })()}

              {/* Cold-on-running warning: Offline migration requires the VM to be off.
                  We ask the user to power it down first instead of auto-powering off,
                  which surprises users whose VM wasn't actually ready for shutdown. */}
              {migType === 'cold' && (esxiMigrateVm?.status === 'running' || esxiMigrateVm?.status === 'poweredOn') && (
                <Alert severity="warning" sx={{ fontSize: 12 }} icon={<i className="ri-alert-line" style={{ fontSize: 18 }} />}>
                  Offline migration requires the source VM to be powered off. Please stop
                  <strong> {esxiMigrateVm.name || esxiMigrateVm.vmid}</strong> before starting
                  the migration, or switch to Live migration.
                </Alert>
              )}
              {/* Live-on-stopped warning: Live migration snapshots the running VM so
                  the transfer happens with zero interruption. On a stopped VM the
                  snapshot step is pointless and you may as well use Offline. Block
                  rather than silently fall back, to make the choice explicit. */}
              {migType === 'live' && esxiMigrateVm && esxiMigrateVm.status !== 'running' && esxiMigrateVm.status !== 'poweredOn' && (
                <Alert severity="warning" sx={{ fontSize: 12 }} icon={<i className="ri-alert-line" style={{ fontSize: 18 }} />}>
                  Live migration requires the source VM to be running (so VMware can
                  snapshot and quiesce the guest). <strong>{esxiMigrateVm.name || esxiMigrateVm.vmid}</strong>
                  is currently {esxiMigrateVm.status || 'stopped'}. Start it first, or switch to
                  Offline migration.
                </Alert>
              )}
              {/* Live-on-Windows-without-Tools: VSS quiesce requires running VMware
                  Tools in the guest, otherwise the snapshot is crash-consistent and
                  virt-v2v fails on the dirty NTFS 10+ minutes into the migration.
                  Fail fast here before the user commits to a long download. */}
              {migType === 'live' && esxiMigrateVm && (esxiMigrateVm.status === 'running' || esxiMigrateVm.status === 'poweredOn') && (esxiMigrateVm.guestOS || '').toLowerCase().includes('windows') && esxiMigrateVm.toolsRunningStatus !== 'guestToolsRunning' && (
                <Alert severity="warning" sx={{ fontSize: 12 }} icon={<i className="ri-alert-line" style={{ fontSize: 18 }} />}>
                  Live migration of a Windows guest requires VMware Tools installed AND running in the source VM
                  (VSS quiesce is the only way to capture a clean NTFS snapshot while the VM keeps running). Current state:
                  toolsStatus=<strong>{esxiMigrateVm.toolsStatus || 'unknown'}</strong>, toolsRunningStatus=<strong>{esxiMigrateVm.toolsRunningStatus || 'unknown'}</strong>.
                  Install VMware Tools on <strong>{esxiMigrateVm.name || esxiMigrateVm.vmid}</strong> and retry, or shut it down
                  (run <code>powercfg /h off</code> then <code>shutdown /s /f /t 0</code> inside Windows) and use Offline migration.
                </Alert>
              )}

              {/* Info banner */}
              <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: theme.palette.mode === 'dark' ? 'rgba(var(--mui-palette-primary-mainChannel) / 0.08)' : 'rgba(var(--mui-palette-primary-mainChannel) / 0.06)', border: '1px solid', borderColor: 'primary.main', borderOpacity: 0.2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-information-line" style={{ fontSize: 18, color: theme.palette.primary.main }} />
                <Typography variant="caption" color="primary">
                  {esxiMigrateVm?.hostType === 'nutanix'
                    ? 'Cold migration only. Disks will be downloaded from Nutanix and converted via virt-v2v with automatic virtio driver injection.'
                    : esxiMigrateVm?.hostType === 'hyperv'
                    ? 'Cold migration only. Mount your Hyper-V share at /mnt/hyperv/ on the target Proxmox node. Disks are detected automatically.'
                    : esxiMigrateVm?.hostType === 'vcenter'
                    ? (migType === 'live'
                        ? 'Live migration: vCenter snapshot is created on the running VM, disks are exported via NFC while the VM stays up, then the source is powered off and the snapshot removed just before virt-v2v runs. Downtime = convert + import + boot (minutes).'
                        : 'Cold migration: the source VM must be powered off. virt-v2v handles disk conversion and virtio driver injection automatically.')
                    : migType === 'cold' ? t('inventoryPage.esxiMigration.coldMigrationInfo')
                    : migType === 'live' ? t('inventoryPage.esxiMigration.liveMigrationInfo')
                    : t('inventoryPage.esxiMigration.sshfsBootMigrationInfo')
                  }
                </Typography>
              </Box>
            </Stack>
          )}

          {/* Migration in progress / completed / failed */}
          {esxiMigrateVm && migJobId && migJob && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {/* Migration visual: VMware → Proxmox */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, py: 2 }}>
                {/* VMware logo */}
                <Box sx={{
                  width: 56, height: 56, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  border: '2px solid', borderColor: migJob.status === 'completed' ? 'success.main' : migJob.status === 'failed' ? 'error.main' : 'divider',
                  transition: 'border-color 0.3s',
                }}>
                  {esxiMigrateVm?.hostType === 'hyperv'
                    ? <img src="/images/hyperv-logo.svg" alt="" width={28} height={28} style={{ opacity: migJob.status === 'completed' ? 0.4 : 1 }} />
                    : <img src={esxiMigrateVm?.hostType === 'nutanix' ? '/images/nutanix-logo.svg' : esxiMigrateVm?.hostType === 'hyperv' ? '/images/hyperv-logo.svg' : esxiMigrateVm?.hostType === 'xcpng' ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'} alt={esxiMigrateVm?.hostType === 'xcpng' ? 'XCP-ng' : 'VMware'} width={28} height={28} style={{ opacity: migJob.status === 'completed' ? 0.4 : 1 }} />
                  }
                </Box>

                {/* Animated flow with tooltip */}
                <MuiTooltip
                  arrow
                  placement="top"
                  title={
                    !['completed', 'failed', 'cancelled'].includes(migJob.status) && migJob.transferSpeed
                      ? `${migJob.transferSpeed}${migJob.bytesTransferred ? ` — ${(Number(migJob.bytesTransferred) / 1073741824).toFixed(1)} GB / ${migJob.totalBytes ? (Number(migJob.totalBytes) / 1073741824).toFixed(1) : '?'} GB` : ''}`
                      : migJob.status === 'completed' ? t('inventoryPage.esxiMigration.completed')
                      : migJob.status === 'failed' ? (migJob.error || t('inventoryPage.esxiMigration.failed'))
                      : migJob.currentStep?.replace(/_/g, ' ') || ''
                  }
                >
                <Box sx={{ flex: 1, maxWidth: 180, position: 'relative', height: 20, display: 'flex', alignItems: 'center', cursor: 'default' }}>
                  {/* Track line */}
                  <Box sx={{ position: 'absolute', inset: 0, top: '50%', height: 2, transform: 'translateY(-50%)', bgcolor: 'divider', borderRadius: 1 }} />
                  {/* Animated dots (only when transferring) */}
                  {!['completed', 'failed', 'cancelled'].includes(migJob.status) ? (
                    <>
                      {[0, 1, 2, 3, 4].map(idx => (
                        <Box key={idx} sx={{
                          position: 'absolute', width: 6, height: 6, borderRadius: '50%',
                          bgcolor: 'primary.main',
                          animation: 'migFlow 2s ease-in-out infinite',
                          animationDelay: `${idx * 0.35}s`,
                          opacity: 0,
                          '@keyframes migFlow': {
                            '0%': { left: '0%', opacity: 0, transform: 'scale(0.5)' },
                            '15%': { opacity: 1, transform: 'scale(1)' },
                            '85%': { opacity: 1, transform: 'scale(1)' },
                            '100%': { left: '100%', opacity: 0, transform: 'scale(0.5)' },
                          },
                        }} />
                      ))}
                    </>
                  ) : migJob.status === 'completed' ? (
                    <Box sx={{ position: 'absolute', inset: 0, top: '50%', height: 2, transform: 'translateY(-50%)', bgcolor: 'success.main', borderRadius: 1 }} />
                  ) : migJob.status === 'failed' ? (
                    <Box sx={{
                      position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                      color: 'error.main', fontSize: 18, lineHeight: 1,
                    }}>
                      <i className="ri-close-circle-fill" />
                    </Box>
                  ) : null}
                </Box>
                </MuiTooltip>

                {/* Proxmox logo */}
                <Box sx={{
                  width: 56, height: 56, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  border: '2px solid',
                  borderColor: migJob.status === 'completed' ? 'success.main' : migJob.status === 'failed' ? 'error.main' : 'divider',
                  transition: 'border-color 0.3s',
                }}>
                  <img
                    src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'}
                    alt="Proxmox" width={28} height={28}
                    style={{ opacity: migJob.status === 'completed' ? 1 : 0.6, transition: 'opacity 0.3s' }}
                  />
                </Box>
              </Box>

              {/* Status chip */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                {migJob.status === 'completed' && <Chip size="small" label={t('inventoryPage.esxiMigration.completed')} color="success" sx={{ fontWeight: 600 }} />}
                {migJob.status === 'failed' && <Chip size="small" label={t('inventoryPage.esxiMigration.failed')} color="error" sx={{ fontWeight: 600 }} />}
                {migJob.status === 'cancelled' && <Chip size="small" label={t('inventoryPage.esxiMigration.cancelled')} color="warning" sx={{ fontWeight: 600 }} />}
                {!['completed', 'failed', 'cancelled'].includes(migJob.status) && (
                  <Chip size="small" label={migJob.currentStep?.replace(/_/g, ' ') || migJob.status} color="primary" sx={{ fontWeight: 600 }} />
                )}
                {migJob.targetVmid && <Typography variant="caption" color="text.secondary">{t('inventoryPage.esxiMigration.targetVmid')}: {migJob.targetVmid}</Typography>}
              </Box>

              {/* Progress bar */}
              {!['completed', 'failed', 'cancelled'].includes(migJob.status) && (
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">{t('inventoryPage.esxiMigration.progress')}</Typography>
                    <Typography variant="caption" fontWeight={700}>{migJob.progress || 0}%</Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={migJob.progress || 0} sx={{ height: 6, borderRadius: 3 }} />
                  {migJob.transferSpeed && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        {migJob.bytesTransferred ? `${(Number(migJob.bytesTransferred) / 1073741824).toFixed(1)} GB` : '0 GB'}
                        {migJob.totalBytes ? ` / ${(Number(migJob.totalBytes) / 1073741824).toFixed(1)} GB` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">{migJob.transferSpeed}</Typography>
                    </Box>
                  )}
                </Box>
              )}

              {/* Error */}
              {migJob.status === 'failed' && migJob.error && (
                <Alert severity="error" sx={{ fontSize: 12 }}>{migJob.error}</Alert>
              )}

              {/* Logs */}
              {migJob.logs?.length > 0 && (
                <Box sx={{ p: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.03)', fontFamily: '"JetBrains Mono", monospace', fontSize: 11, maxHeight: 250, overflow: 'auto', borderRadius: 1.5, lineHeight: 1.8 }}>
                  {migJob.logs.map((log: any, i: number) => (
                    <Box key={i}>
                      <Box component="span" sx={{ color: 'text.secondary' }}>[{new Date(log.ts).toLocaleTimeString()}]</Box>{' '}
                      {log.level === 'success' && <Box component="span" sx={{ color: 'success.main' }}>✓ </Box>}
                      {log.level === 'error' && <Box component="span" sx={{ color: 'error.main' }}>✗ </Box>}
                      {log.level === 'warn' && <Box component="span" sx={{ color: 'warning.main' }}>⚠ </Box>}
                      {log.msg}
                    </Box>
                  ))}
                </Box>
              )}
            </Stack>
          )}

          {/* Loading state while starting */}
          {esxiMigrateVm && migStarting && !migJobId && (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <CircularProgress size={32} />
              <Typography variant="body2" sx={{ mt: 1, opacity: 0.6 }}>{t('inventoryPage.esxiMigration.startingMigration')}</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {!migJobId ? (
            <>
              <Button onClick={() => setEsxiMigrateVm(null)} disabled={migStarting}>{t('common.cancel')}</Button>
              <Button
                variant="outlined"
                disabled={(() => {
                  // Base requirements (always apply)
                  if (!migTargetConn || !migTargetNode || !migTargetStorage || migStarting) return true
                  const isV2vSource = esxiMigrateVm?.hostType === 'vcenter' || esxiMigrateVm?.hostType === 'hyperv' || esxiMigrateVm?.hostType === 'nutanix'
                  // Power-state gates: cold needs the VM off, live needs it on.
                  // Applies to every source type. Auto-power-off/on is intentionally
                  // NOT done here - the user toggles VM state on the source hypervisor
                  // themselves so a surprise shutdown never happens, and live migration
                  // on a stopped VM is pointless (it becomes just a cold run with an
                  // orphan snapshot attempt).
                  const isRunning = esxiMigrateVm?.status === 'running' || esxiMigrateVm?.status === 'poweredOn'
                  if (migType === 'cold' && isRunning) return true
                  if (migType === 'live' && esxiMigrateVm && !isRunning) return true
                  // Live + Windows needs running VMware Tools for VSS quiesce,
                  // otherwise virt-v2v will fail on a dirty NTFS. Fail fast in
                  // the UI rather than 10 min into the migration.
                  if (migType === 'live' && esxiMigrateVm && (esxiMigrateVm.guestOS || '').toLowerCase().includes('windows') && esxiMigrateVm.toolsRunningStatus !== 'guestToolsRunning') return true
                  if (isV2vSource) {
                    if (!vcenterPreflight?.checked) return false // preflight not run yet, don't pre-gate
                    if (!vcenterPreflight.virtV2vInstalled) return true
                    if (!vcenterPreflight.nbdkitInstalled) return true
                    if (!vcenterPreflight.nbdcopyInstalled) return true
                    if (!vcenterPreflight.guestfsToolsInstalled) return true
                    if (!vcenterPreflight.ovmfInstalled) return true
                    // virtio-win is required for Windows guests — without it the
                    // VM will likely BSOD with INACCESSIBLE_BOOT_DEVICE.
                    const isWindowsGuest = !!esxiMigrateVm?.guestOS?.toLowerCase().includes('win')
                    if (isWindowsGuest && !vcenterPreflight.virtioWinInstalled) return true
                    // Temp storage must have at least 2x the source VM's committed
                    // space (rough heuristic: NFC download + virt-v2v converted output).
                    if (!migTempStorage) return true
                    const sel = vcenterPreflight.tempStorages?.find(s => s.path === migTempStorage)
                    if (!sel || sel.availableBytes < (esxiMigrateVm?.committed || 0) * 2) return true
                    return false
                  }
                  // ESXi-direct path: SSH must be configured on the target Proxmox
                  // connection and sshfs/pv must be available when those modes selected.
                  if (migTargetConn && !migPveConnections.find((c: any) => c.id === migTargetConn)?.sshEnabled) return true
                  if (migSshfsAvailable === false && (migTransferMode === 'sshfs' || migType === 'sshfs_boot')) return true
                  return false
                })()}
                sx={{ textTransform: 'none' }}
                startIcon={migStarting ? <CircularProgress size={16} color="inherit" /> : <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={16} height={16} />}
                onClick={async () => {
                  if (!esxiMigrateVm) return
                  setMigStarting(true)
                  try {
                    const res = await fetch('/api/v1/migrations', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        sourceConnectionId: esxiMigrateVm.connId,
                        sourceVmId: esxiMigrateVm.vmid,
                        sourceVmName: esxiMigrateVm.name,
                        targetConnectionId: migTargetConn,
                        targetNode: migTargetNode,
                        targetStorage: migTargetStorage,
                        networkBridge: migNetworkBridge,
                        // vCenter supports cold + live via the v2v pipeline
                        // (NFC-on-snapshot). Hyper-V / Nutanix are still cold only.
                        migrationType: (esxiMigrateVm.hostType === 'hyperv' || esxiMigrateVm.hostType === 'nutanix') ? 'cold'
                          : (esxiMigrateVm.hostType === 'vcenter' ? (migType === 'sshfs_boot' ? 'cold' : migType) : migType),
                        transferMode: (esxiMigrateVm.hostType === 'vcenter' || esxiMigrateVm.hostType === 'hyperv' || esxiMigrateVm.hostType === 'nutanix') ? 'v2v' : migTransferMode,
                        startAfterMigration: migStartAfter,
                        ...((esxiMigrateVm.hostType === 'vcenter' || esxiMigrateVm.hostType === 'hyperv' || esxiMigrateVm.hostType === 'nutanix') && migTempStorage !== '/tmp' && {
                          tempStorage: migTempStorage,
                        }),
                        ...(esxiMigrateVm.hostType === 'hyperv' && migDiskPaths.trim() && {
                          diskPaths: migDiskPaths.trim().split('\n').map((p: string) => p.trim()).filter(Boolean),
                        }),
                        // vCenter inventory path resolved server-side via SOAP and threaded
                        // down through esxiMigrateVm. Required by libvirt's vpx driver to
                        // locate the VM in the vCenter inventory hierarchy.
                        // We deliberately DO NOT gate on hostType==='vcenter' here: the
                        // backend route decides whether to invoke the v2v pipeline based on
                        // the connection's subType (DB-side), and the frontend hostType has
                        // historically only been set to 'vmware' for both ESXi and vCenter.
                        // Sending these fields unconditionally is harmless for ESXi (where
                        // they're always undefined and the spreads no-op) and unblocks
                        // vCenter regardless of how the host derived hostType.
                        ...((esxiMigrateVm as any).vcenterDatacenter && {
                          vcenterDatacenter: (esxiMigrateVm as any).vcenterDatacenter,
                        }),
                        ...((esxiMigrateVm as any).vcenterCluster && {
                          vcenterCluster: (esxiMigrateVm as any).vcenterCluster,
                        }),
                        ...((esxiMigrateVm as any).vcenterHost && {
                          vcenterHost: (esxiMigrateVm as any).vcenterHost,
                        }),
                      }),
                    })
                    const d = await res.json()
                    if (d.data?.jobId) {
                      const jobId = d.data.jobId
                      setMigJobId(jobId)
                      // Add task to ProxCenter TasksBar
                      const taskId = `migration-${jobId}`
                      const vmLabel = esxiMigrateVm.name || esxiMigrateVm.vmid
                      const sourceType = esxiMigrateVm.hostType === 'xcpng' ? 'XCP-ng' : esxiMigrateVm.hostType === 'vcenter' ? 'vCenter' : esxiMigrateVm.hostType === 'hyperv' ? 'Hyper-V' : esxiMigrateVm.hostType === 'nutanix' ? 'Nutanix' : 'ESXi'
                      addPCTask({
                        id: taskId,
                        type: 'generic',
                        label: `${t('inventoryPage.esxiMigration.migrating')} ${vmLabel} (${sourceType} → Proxmox)`,
                        detail: t('inventoryPage.esxiMigration.preflight'),
                        progress: 0,
                        status: 'running',
                        createdAt: Date.now(),
                      })
                      // Register restore callback to reopen dialog
                      const savedVm = { ...esxiMigrateVm }
                      registerOnRestore(taskId, () => {
                        setEsxiMigrateVm(savedVm)
                        setMigJobId(jobId)
                      })
                    } else {
                      throw new Error(d.error || 'Failed to start migration')
                    }
                  } catch (e: any) {
                    alert(e.message || 'Migration failed to start')
                  } finally {
                    setMigStarting(false)
                  }
                }}
              >
                {t('inventoryPage.esxiMigration.startMigration')}
              </Button>
            </>
          ) : (
            <>
              {migJob && !['completed', 'failed', 'cancelled'].includes(migJob.status) && (
                <>
                  <Button
                    color="error"
                    onClick={async () => {
                      const res = await fetch(`/api/v1/migrations/${migJobId}/cancel`, { method: 'POST' })
                      const d = await res.json().catch(() => ({}))
                      if (d.data) setMigJob(d.data)
                    }}
                  >
                    {t('inventoryPage.esxiMigration.cancelMigration')}
                  </Button>
                  <Button
                    startIcon={<i className="ri-subtract-line" />}
                    onClick={() => setEsxiMigrateVm(null)}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('inventoryPage.esxiMigration.minimize')}
                  </Button>
                </>
              )}
              {migJob && migJob.status === 'failed' && (
                <Button
                  onClick={async () => {
                    const res = await fetch(`/api/v1/migrations/${migJobId}/retry`, { method: 'POST' })
                    const d = await res.json()
                    if (d.data?.jobId) setMigJobId(d.data.jobId)
                  }}
                >
                  {t('inventoryPage.esxiMigration.retry')}
                </Button>
              )}
              {migJob && ['completed', 'failed', 'cancelled'].includes(migJob.status) && (
                <Button onClick={() => { setEsxiMigrateVm(null); setMigJobId(null); setMigJob(null); setMigType('cold'); setMigTransferMode('sshfs') }}>
                  {t('common.close')}
                </Button>
              )}
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Bulk Migration Dialog */}
      <Dialog open={bulkMigOpen} onClose={() => { if (!bulkMigStarting && bulkMigJobs.length === 0) setBulkMigOpen(false) }} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {bulkMigHostInfo?.hostType === 'hyperv'
            ? <img src="/images/hyperv-logo.svg" alt="" width={22} height={22} />
            : <img src={bulkMigHostInfo?.hostType === 'nutanix' ? '/images/nutanix-logo.svg' : bulkMigHostInfo?.hostType === 'hyperv' ? '/images/hyperv-logo.svg' : bulkMigHostInfo?.hostType === 'xcpng' ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'} alt="" width={22} height={22} />
          }
          {t('inventoryPage.esxiMigration.bulkMigration')} ({bulkMigSelected.size} VMs)
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {/* Selected VMs summary — uses the same VM-icon + status-pastille
                visual as the inventory tree (see InventoryTree.tsx renderVmItem)
                so the user gets a consistent at-a-glance status across the app.
                The hypervisor-specific icon (esxi-vm.svg / ri-computer-line) is
                chosen from bulkMigHostInfo.hostType; the bottom-right dot is
                green=running, orange=paused/suspended, red=stopped.
                Hidden once migration starts (bulkMigJobs populated): the
                per-job progress rows below already list the same VMs with
                live status, so the static summary becomes redundant noise. */}
            {bulkMigJobs.length === 0 && <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider', maxHeight: 150, overflow: 'auto' }}>
              <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('inventoryPage.esxiMigration.selectedVms')}</Typography>
              {(() => {
                // Pick the hypervisor-specific VM icon. Mirrors the small map
                // used in InventoryTree.tsx for the migration section.
                const vmIconByType: Record<string, string | undefined> = {
                  vmware: '/images/esxi-vm.svg',
                  hyperv: undefined,
                  xcpng: undefined,
                  nutanix: undefined,
                }
                const vmIconSrc = vmIconByType[bulkMigHostInfo?.hostType || ''] || undefined
                return (bulkMigHostInfo?.vms || []).filter((vm: any) => bulkMigSelected.has(vm.vmid)).map((vm: any) => {
                  const dotColor =
                    vm.status === 'running' ? '#4caf50' :
                    vm.status === 'paused' || vm.status === 'suspended' ? '#ed6c02' :
                    '#f44336'
                  return (
                    <Box key={vm.vmid} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.3 }}>
                      <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flexShrink: 0 }}>
                        {vmIconSrc
                          ? <img src={vmIconSrc} alt="" width={14} height={14} style={{ opacity: 0.7 }} />
                          : <i className="ri-computer-line" style={{ fontSize: 14, opacity: 0.7 }} />
                        }
                        <Box sx={{
                          position: 'absolute', bottom: -2, right: -3,
                          width: 7, height: 7, borderRadius: '50%',
                          bgcolor: dotColor,
                          border: '1.5px solid', borderColor: 'background.paper',
                          boxShadow: vm.status === 'running' ? `0 0 4px ${dotColor}` : 'none',
                        }} />
                      </Box>
                      <Typography variant="body2" fontSize={12} fontWeight={600}>{vm.name || vm.vmid}</Typography>
                    </Box>
                  )
                })
              })()}
            </Box>}

            {bulkMigJobs.length === 0 && (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                  <i className="ri-arrow-down-line" style={{ fontSize: 24, color: theme.palette.primary.main }} />
                </Box>

                {/* Target config — reuse same selectors as single migration */}
                <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="subtitle2" sx={{ mb: 1.5, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('inventoryPage.esxiMigration.targetProxmox')}</Typography>
                  <Stack spacing={2}>
                    <FormControl fullWidth size="small">
                      <InputLabel>{t('inventoryPage.esxiMigration.targetNode')}</InputLabel>
                      <Select
                        /*
                         * Value encoding: "<connId>::<node>" for a specific node,
                         * "<connId>::__auto__" for cluster-wide round-robin auto.
                         * The legacy global "__auto__" is gone — it silently picked
                         * the first connection and was unusable in multi-cluster
                         * setups (migNodes stayed empty, bulk distribution failed).
                         * Auto is now per-cluster so the user explicitly picks
                         * WHICH cluster to spread the batch across.
                         */
                        value={migTargetConn && migTargetNode ? `${migTargetConn}::${migTargetNode}` : ''}
                        onChange={e => {
                          const val = e.target.value as string
                          const [connId, node] = val.split('::')
                          setMigTargetConn(connId || '')
                          setMigTargetNode(node || '')
                          setMigTargetStorage('')
                          setMigNetworkBridge('')
                        }}
                        label={t('inventoryPage.esxiMigration.targetNode')}
                        renderValue={(val) => {
                          const [connId, node] = (val as string).split('::')
                          const conn = migPveConnections.find((c: any) => c.id === connId)
                          const opt = migNodeOptions.find((o: any) => o.connId === connId && o.node === node)
                          const isCluster = conn?.hosts?.length > 1
                          const isDarkRv = theme.palette.mode === 'dark'
                          if (!conn) return ''
                          // Auto mode tied to a cluster: show a clear label that
                          // makes the scope obvious ("Auto across <cluster>") so
                          // the user knows the batch lands only on that cluster's
                          // nodes, not everywhere.
                          if (node === '__auto__') return (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <i className="ri-equalizer-line" style={{ fontSize: 14, color: theme.palette.primary.main }} />
                              <Typography variant="body2" fontWeight={500}>
                                {t('inventoryPage.esxiMigration.autoDistribute')} — {conn.name}
                              </Typography>
                            </Box>
                          )
                          return (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                <img src={isDarkRv ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                                <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: opt?.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                              </Box>
                              <Typography variant="body2" fontWeight={500}>{isCluster ? `${node} (${conn.name})` : conn.name}</Typography>
                            </Box>
                          )
                        }}
                      >
                        {migPveConnections.map((conn: any, connIdx: number) => {
                          const isCluster = conn.hosts?.length > 1
                          const isDark = theme.palette.mode === 'dark'
                          const connNodes = migNodeOptions.filter((o: any) => o.connId === conn.id)
                          const items: React.ReactNode[] = []
                          if (connIdx > 0) items.push(<Divider key={`div-${conn.id}`} />)
                          if (isCluster) {
                            items.push(
                              <MenuItem key={`header-${conn.id}`} disabled sx={{ opacity: '1 !important', py: 0.5, minHeight: 32, bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                  <i className="ri-server-fill" style={{ fontSize: 14, opacity: 0.8 }} />
                                  <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10, color: 'text.secondary' }}>
                                    {conn.name}
                                  </Typography>
                                  <Chip size="small" label="Cluster" sx={{ height: 16, fontSize: 9, fontWeight: 600 }} />
                                </Box>
                              </MenuItem>
                            )
                            // Per-cluster Auto entry: round-robin across THIS cluster's
                            // nodes only. Previously there was a single global Auto that
                            // silently bound to the first connection — unusable in multi-
                            // cluster setups. Exposing it per-cluster makes the scope
                            // obvious to the user.
                            items.push(
                              <MenuItem key={`${conn.id}::__auto__`} value={`${conn.id}::__auto__`} sx={{ pl: 4 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                  <i className="ri-equalizer-line" style={{ fontSize: 16, color: theme.palette.primary.main, width: 14 }} />
                                  <Box>
                                    <Typography variant="body2" fontWeight={600} fontSize={13}>
                                      {t('inventoryPage.esxiMigration.autoDistribute')}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" fontSize={10}>
                                      {t('inventoryPage.esxiMigration.autoDistributeDesc')}
                                    </Typography>
                                  </Box>
                                </Box>
                              </MenuItem>,
                            )
                            connNodes.forEach((node: any) => {
                              items.push(
                                <MenuItem key={`${conn.id}::${node.node}`} value={`${conn.id}::${node.node}`} sx={{ pl: 4 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                    <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                      <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                                      <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: node.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                                    </Box>
                                    <Typography variant="body2" fontWeight={500}>{node.node}</Typography>
                                    {node.ip && <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>{node.ip}</Typography>}
                                  </Box>
                                </MenuItem>
                              )
                            })
                          } else {
                            const node = connNodes[0]
                            if (node) {
                              items.push(
                                <MenuItem key={`${conn.id}::${node.node}`} value={`${conn.id}::${node.node}`}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                    <Box component="span" sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                                      <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                                      <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: node.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                                    </Box>
                                    <Typography variant="body2" fontWeight={500}>{conn.name}</Typography>
                                    {node.ip && <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>{node.ip}</Typography>}
                                  </Box>
                                </MenuItem>
                              )
                            }
                          }
                          return items
                        })}
                      </Select>
                    </FormControl>
                    {migTargetNode && (
                      <>
                        <FormControl fullWidth size="small">
                          <InputLabel>{t('inventoryPage.esxiMigration.targetStorage')}</InputLabel>
                          <Select
                            value={migTargetStorage}
                            onChange={e => setMigTargetStorage(e.target.value)}
                            label={t('inventoryPage.esxiMigration.targetStorage')}
                            renderValue={(val) => {
                              const s = migStorages.find((s: any) => s.storage === val)
                              if (!s) return ''
                              return (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.7 }} />
                                  <Typography variant="body2" fontWeight={500}>{s.storage}</Typography>
                                  <Typography variant="caption" sx={{ opacity: 0.5 }}>({s.type})</Typography>
                                </Box>
                              )
                            }}
                          >
                            {migStorages.map((s: any) => {
                              const usedPct = s.total && s.avail ? Math.round(((s.total - s.avail) / s.total) * 100) : 0
                              return (
                                <MenuItem key={s.storage} value={s.storage}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                    <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.7 }} />
                                    <Typography variant="body2" fontWeight={500}>{s.storage}</Typography>
                                    <Typography variant="caption" sx={{ opacity: 0.5 }}>({s.type})</Typography>
                                    <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 100 }}>
                                      <Box sx={{ flex: 1, height: 4, bgcolor: 'action.hover', borderRadius: 0, overflow: 'hidden' }}>
                                        <Box sx={{ height: '100%', width: `${usedPct}%`, bgcolor: usedPct > 85 ? 'error.main' : usedPct > 60 ? 'warning.main' : 'success.main', transition: 'width 0.3s' }} />
                                      </Box>
                                      <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6, whiteSpace: 'nowrap' }}>
                                        {s.avail ? `${(s.avail / 1073741824).toFixed(1)} GB` : ''}
                                      </Typography>
                                    </Box>
                                  </Box>
                                </MenuItem>
                              )
                            })}
                          </Select>
                          {migTargetNode === '__auto__' && <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, ml: 1.5 }}>{t('inventoryPage.esxiMigration.sharedStorageHint')}</Typography>}
                        </FormControl>
                        <FormControl fullWidth size="small">
                          <InputLabel>{t('inventoryPage.esxiMigration.networkBridge')}</InputLabel>
                          <Select
                            value={migNetworkBridge}
                            onChange={e => setMigNetworkBridge(e.target.value)}
                            label={t('inventoryPage.esxiMigration.networkBridge')}
                            renderValue={(val) => {
                              const b = migBridges.find((b: any) => b.iface === val)
                              if (!b) return ''
                              return (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <i className="ri-router-line" style={{ fontSize: 14, opacity: 0.7 }} />
                                  <Typography variant="body2" fontWeight={500}>{b.iface}</Typography>
                                  {b.comments && <Typography variant="caption" sx={{ opacity: 0.5 }}>({b.comments})</Typography>}
                                </Box>
                              )
                            }}
                          >
                            {migBridges.map((b: any) => (
                              <MenuItem key={b.iface} value={b.iface}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                  <i className="ri-router-line" style={{ fontSize: 14, opacity: 0.7 }} />
                                  <Typography variant="body2" fontWeight={500}>{b.iface}</Typography>
                                  {b.comments && <Typography variant="caption" sx={{ opacity: 0.5 }}>({b.comments})</Typography>}
                                  {b.cidr && <Typography variant="caption" sx={{ opacity: 0.5, ml: 'auto' }}>{b.cidr}</Typography>}
                                </Box>
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </>
                    )}
                  </Stack>
                </Box>

                {/* Migration type — hidden for Hyper-V / Nutanix (cold only).
                    vCenter supports cold + live (NFC-on-snapshot); direct ESXi
                    additionally supports sshfs_boot. */}
                {bulkMigHostInfo?.hostType !== 'hyperv' && bulkMigHostInfo?.hostType !== 'nutanix' && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.75, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {t('inventoryPage.esxiMigration.migrationType')}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    {([
                      { value: 'cold' as const, icon: 'ri-shut-down-line', color: 'info.main', labelKey: 'migrationTypeCold', descKey: 'migrationTypeColdDesc' },
                      { value: 'live' as const, icon: 'ri-flashlight-line', color: 'success.main', labelKey: 'migrationTypeLive', descKey: 'migrationTypeLiveDesc' },
                      { value: 'sshfs_boot' as const, icon: 'ri-speed-line', color: 'warning.main', labelKey: 'migrationTypeSshfsBoot', descKey: 'migrationTypeSshfsBootDesc' },
                    ]).filter(opt => bulkMigHostInfo?.hostType !== 'vcenter' || opt.value !== 'sshfs_boot').map(opt => (
                      <MuiTooltip key={opt.value} title={t(`inventoryPage.esxiMigration.${opt.descKey}`)} arrow placement="top">
                        <Box
                          onClick={() => setMigType(opt.value)}
                          sx={{
                            flex: 1, py: 1, px: 1.5, borderRadius: 1.5, border: '2px solid', cursor: 'pointer', transition: 'all 0.15s',
                            borderColor: migType === opt.value ? `${opt.color}` : 'divider',
                            bgcolor: migType === opt.value ? (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)') : 'transparent',
                            '&:hover': { borderColor: `${opt.color}` },
                            display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center',
                          }}
                        >
                          <i className={opt.icon} style={{ fontSize: 16, color: migType === opt.value ? theme.palette[opt.color.split('.')[0] as 'info' | 'success' | 'warning'].main : undefined, opacity: migType === opt.value ? 1 : 0.6 }} />
                          <Typography variant="body2" fontWeight={migType === opt.value ? 700 : 500} fontSize={12} noWrap>
                            {t(`inventoryPage.esxiMigration.${opt.labelKey}`)}
                          </Typography>
                        </Box>
                      </MuiTooltip>
                    ))}
                  </Stack>
                </Box>
                )}

                {/* Transfer mode — hidden for vCenter (virt-v2v handles transfer) */}
                {bulkMigHostInfo?.hostType !== 'vcenter' && bulkMigHostInfo?.hostType !== 'hyperv' && bulkMigHostInfo?.hostType !== 'nutanix' && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.75, color: 'text.secondary', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {t('inventoryPage.esxiMigration.transferMode')}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    {([
                      { value: 'sshfs' as const, icon: 'ri-folder-shared-line', color: 'warning.main', labelKey: 'transferModeSshfs', descKey: 'transferModeSshfsDesc' },
                      { value: 'https' as const, icon: 'ri-download-cloud-line', color: 'info.main', labelKey: 'transferModeHttps', descKey: 'transferModeHttpsDesc' },
                    ]).map(opt => (
                      <MuiTooltip key={opt.value} title={t(`inventoryPage.esxiMigration.${opt.descKey}`)} arrow placement="top">
                        <Box
                          onClick={() => setMigTransferMode(opt.value)}
                          sx={{
                            flex: 1, py: 1, px: 1.5, borderRadius: 1.5, border: '2px solid', cursor: 'pointer', transition: 'all 0.15s',
                            borderColor: migTransferMode === opt.value ? `${opt.color}` : 'divider',
                            bgcolor: migTransferMode === opt.value ? (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)') : 'transparent',
                            '&:hover': { borderColor: `${opt.color}` },
                            display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'center',
                          }}
                        >
                          <i className={opt.icon} style={{ fontSize: 16, color: migTransferMode === opt.value ? theme.palette[opt.color.split('.')[0] as 'warning' | 'info'].main : undefined, opacity: migTransferMode === opt.value ? 1 : 0.6 }} />
                          <Typography variant="body2" fontWeight={migTransferMode === opt.value ? 700 : 500} fontSize={12} noWrap>
                            {t(`inventoryPage.esxiMigration.${opt.labelKey}`)}
                          </Typography>
                        </Box>
                      </MuiTooltip>
                    ))}
                  </Stack>
                </Box>
                )}

                {/* sshfs not installed warning */}
                {bulkMigHostInfo?.hostType !== 'vcenter' && bulkMigHostInfo?.hostType !== 'hyperv' && bulkMigHostInfo?.hostType !== 'nutanix' && migSshfsAvailable === false && (migTransferMode === 'sshfs' || migType === 'sshfs_boot') && (
                  <Alert severity="warning" sx={{ fontSize: 12 }} icon={<i className="ri-folder-shared-line" style={{ fontSize: 18 }} />}>
                    {t('inventoryPage.esxiMigration.sshfsNotInstalled')}
                  </Alert>
                )}

                {/* vCenter/Hyper-V info banner for bulk */}
                {bulkMigHostInfo?.hostType === 'vcenter' && (
                  <Alert severity="info" sx={{ fontSize: 12 }} icon={<i className="ri-information-line" style={{ fontSize: 18 }} />}>
                    {migType === 'live'
                      ? 'Live migration: each VM is snapshotted, its disks are NFC-exported while it stays running, then the source is powered off + snapshot removed just before virt-v2v. Per-VM downtime = convert + import + boot.'
                      : 'Cold migration: each source VM must be powered off first. virt-v2v handles disk conversion and virtio driver injection automatically.'}
                  </Alert>
                )}
                {bulkMigHostInfo?.hostType === 'hyperv' && (
                  <Alert severity="info" sx={{ fontSize: 12 }} icon={<i className="ri-information-line" style={{ fontSize: 18 }} />}>
                    Cold migration only. Mount your Hyper-V share at /mnt/hyperv/ on the target Proxmox node. Disks are detected automatically.
                  </Alert>
                )}
                {bulkMigHostInfo?.hostType === 'nutanix' && (
                  <Alert severity="info" sx={{ fontSize: 12 }} icon={<i className="ri-information-line" style={{ fontSize: 18 }} />}>
                    Cold migration only. Disks will be downloaded from Nutanix and converted via virt-v2v with automatic virtio driver injection.
                  </Alert>
                )}

                {/* vCenter/Hyper-V/Nutanix preflight checklist for bulk migration.
                    Mirrors the single-VM checklist above: the Install button only
                    covers apt-installable deps (virt-v2v / nbdkit / libnbd-bin),
                    virtio-win is a separate manual step surfaced via instructions
                    below and does NOT block the Start Migration button. */}
                {(bulkMigHostInfo?.hostType === 'vcenter' || bulkMigHostInfo?.hostType === 'hyperv' || bulkMigHostInfo?.hostType === 'nutanix') && vcenterPreflight?.checked && (() => {
                  const isAutoBulk = migTargetNode === '__auto__'
                  const checkedNodesBulk = isAutoBulk
                    ? migNodeOptions.filter((o: any) => o.connId === migTargetConn && o.status === 'online').length
                    : 1
                  const scopeLabelBulk = isAutoBulk ? `all ${checkedNodesBulk} online nodes of the cluster` : 'the target node'
                  // Detect whether the user has any Windows VMs in the selected
                  // batch by looking at the Guest OS string each hypervisor
                  // reports (same field shown in the "Guest OS" table column).
                  // If the batch is 100% Linux, virtio-win is irrelevant and we
                  // hide both the checklist row and the manual install block to
                  // avoid noise. Mixed Linux+Windows batches still show it.
                  const selectedVms = (bulkMigHostInfo?.vms || []).filter((vm: any) => bulkMigSelected.has(vm.vmid))
                  const hasWindowsInBatch = selectedVms.some((vm: any) => {
                    const os = (vm.guest_OS || vm.guestOS || '').toString().toLowerCase()
                    return os.includes('win')
                  })
                  const aptChecklistBulk = [
                    { label: 'virt-v2v', installed: vcenterPreflight.virtV2vInstalled, required: true, note: 'VM OS conversion + driver injection' },
                    { label: 'nbdkit', installed: vcenterPreflight.nbdkitInstalled, required: true, note: 'needed by virt-v2v -i disk on vSAN VMs' },
                    { label: 'libnbd-bin (nbdcopy)', installed: vcenterPreflight.nbdcopyInstalled, required: true, note: 'virt-v2v disk copy step' },
                    { label: 'guestfs-tools (rhsrvany)', installed: vcenterPreflight.guestfsToolsInstalled, required: true, note: 'Windows firstboot scripts' },
                    { label: 'ovmf', installed: vcenterPreflight.ovmfInstalled, required: true, note: 'UEFI firmware for output metadata' },
                  ]
                  const virtioWinMissingBulk = !vcenterPreflight.virtioWinInstalled && hasWindowsInBatch
                  const missingAptBulk = aptChecklistBulk.some(d => !d.installed)
                  // Only include the virtio-win row in the checklist when the
                  // batch actually contains a Windows guest — no point showing
                  // it otherwise.
                  const fullChecklist = hasWindowsInBatch
                    ? [
                      ...aptChecklistBulk,
                      { label: 'virtio-win ISO', installed: vcenterPreflight.virtioWinInstalled, required: false, note: 'Windows guest drivers — MANUAL install, optional' },
                    ]
                    : aptChecklistBulk
                  if (!missingAptBulk && !virtioWinMissingBulk) {
                    return (
                      <Alert severity="success" sx={{ fontSize: 12 }} icon={<i className="ri-checkbox-circle-line" style={{ fontSize: 18 }} />}>
                        All virt-v2v dependencies are installed on {scopeLabelBulk}.
                      </Alert>
                    )
                  }
                  return (
                    <>
                    {missingAptBulk && <Alert
                      severity="warning"
                      sx={{ fontSize: 12, '& .MuiAlert-message': { width: '100%' } }}
                      icon={<i className="ri-tools-line" style={{ fontSize: 18 }} />}
                    >
                      <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                        {isAutoBulk
                          ? `At least one node in the cluster is missing required migration tools (checked ${checkedNodesBulk} online nodes)`
                          : 'Target node is missing required migration tools'}
                      </Typography>
                      <Box component="ul" sx={{ m: 0, pl: 2, mb: 1 }}>
                        {fullChecklist.map(dep => (
                          <Box
                            component="li"
                            key={dep.label}
                            sx={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: 1, fontSize: 11, py: 0.25, opacity: dep.required ? 1 : 0.7 }}
                          >
                            {dep.installed ? (
                              <i className="ri-checkbox-circle-fill" style={{ fontSize: 14, color: '#2e7d32' }} />
                            ) : (
                              <i className="ri-close-circle-fill" style={{ fontSize: 14, color: dep.required ? '#d32f2f' : '#ed6c02' }} />
                            )}
                            <span><strong>{dep.label}</strong>{dep.note ? <span style={{ opacity: 0.6 }}> — {dep.note}</span> : null}{!dep.required ? <span style={{ opacity: 0.6 }}> (optional)</span> : null}</span>
                          </Box>
                        ))}
                      </Box>
                      <Button
                        size="small"
                        color="warning"
                        variant="contained"
                        disabled={vcenterPreflight.installing}
                        startIcon={vcenterPreflight.installing ? <CircularProgress size={14} color="inherit" /> : <i className="ri-download-line" />}
                        onClick={async () => {
                          setVcenterPreflight(prev => prev ? { ...prev, installing: true } : prev)
                          try {
                            // Bulk install target = every online node of the cluster when
                            // Auto is selected. apt-installs virt-v2v + nbdkit + libnbd-bin
                            // only. virtio-win is manual and handled in the instruction
                            // block below.
                            const installNodes = migTargetNode === '__auto__'
                              ? migNodeOptions.filter((o: any) => o.connId === migTargetConn && o.status === 'online').map((o: any) => o.node)
                              : [migTargetNode]
                            await Promise.all(installNodes.map((node: string) => fetch('/api/v1/migrations/preflight', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: node, action: 'install' }),
                            })))
                            const results = await Promise.all(installNodes.map(async (node: string) => {
                              const r2 = await fetch('/api/v1/migrations/preflight', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ targetConnectionId: migTargetConn, targetNode: node }),
                              })
                              return r2.json()
                            }))
                            setVcenterPreflight({
                              checked: true,
                              ok: results.every((r: any) => !(r.errors || []).length),
                              installing: false,
                              errors: [],
                              virtV2vInstalled: results.every((r: any) => !!r.virtV2vInstalled),
                              virtioWinInstalled: results.every((r: any) => !!r.virtioWinInstalled),
                              nbdkitInstalled: results.every((r: any) => !!r.nbdkitInstalled),
                              nbdcopyInstalled: results.every((r: any) => !!r.nbdcopyInstalled),
                              guestfsToolsInstalled: results.every((r: any) => !!r.guestfsToolsInstalled),
                              ovmfInstalled: results.every((r: any) => !!r.ovmfInstalled),
                              detectedDisks: [],
                              tempStorages: results[0]?.tempStorages || [],
                            })
                          } catch {
                            setVcenterPreflight(prev => prev ? { ...prev, installing: false } : prev)
                          }
                        }}
                        sx={{ textTransform: 'none', fontSize: 11, whiteSpace: 'nowrap' }}
                      >
                        {vcenterPreflight.installing
                          ? (isAutoBulk ? `Installing on ${checkedNodesBulk} nodes…` : 'Installing on target node…')
                          : 'Install missing packages'}
                      </Button>
                    </Alert>}
                    {virtioWinMissingBulk && (() => {
                      const windowsCount = selectedVms.filter((vm: any) => {
                        const os = (vm.guest_OS || vm.guestOS || '').toString().toLowerCase()
                        return os.includes('win')
                      }).length
                      return (
                        <Alert severity="info" sx={{ fontSize: 11, mt: 1, '& .MuiAlert-message': { width: '100%' } }} icon={<i className="ri-windows-line" style={{ fontSize: 18 }} />}>
                          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                            virtio-win ISO ({windowsCount} Windows VM{windowsCount === 1 ? '' : 's'} in the batch)
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1, fontSize: 11 }}>
                            Windows VirtIO drivers required for Windows VMs to boot after conversion.
                          </Typography>
                          {virtioWinProgress ? (
                            <Box>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                <Typography variant="caption" sx={{ fontSize: 10 }}>
                                  Downloading virtio-win.iso… {(virtioWinProgress.sizeBytes / 1048576).toFixed(0)} MB
                                </Typography>
                                <Typography variant="caption" fontWeight={700} sx={{ fontSize: 10 }}>
                                  {virtioWinProgress.percent}%
                                </Typography>
                              </Box>
                              <LinearProgress variant="determinate" value={virtioWinProgress.percent} sx={{ height: 6, borderRadius: 1 }} />
                            </Box>
                          ) : (
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<i className="ri-download-2-line" />}
                              onClick={startVirtioWinDownload}
                              sx={{ textTransform: 'none', fontSize: 11 }}
                            >
                              Download virtio-win ISO (~700 MB)
                            </Button>
                          )}
                        </Alert>
                      )
                    })()}
                    </>
                  )
                })()}

                {/* Temporary storage for virt-v2v (bulk). Without this, the
                    API defaults to /tmp on the target node, which is often a
                    small partition (tmpfs or root FS). For bulk jobs with
                    several multi-GB VMs the dir fills up and subsequent
                    migrations hang or fail with "no space left on device". */}
                {(bulkMigHostInfo?.hostType === 'vcenter' || bulkMigHostInfo?.hostType === 'hyperv' || bulkMigHostInfo?.hostType === 'nutanix') && vcenterPreflight?.tempStorages && vcenterPreflight.tempStorages.length > 0 && (() => {
                  const selectedBulkVms = (bulkMigHostInfo?.vms || []).filter((vm: any) => bulkMigSelected.has(vm.vmid))
                  // Peak disk usage in bulk = biggest committed disk × 2 (source + converted).
                  // Sequential runs (BULK_MIG_CONCURRENCY=1) so only one VM occupies tempStorage at a time.
                  const maxCommitted = selectedBulkVms.reduce((m: number, vm: any) => Math.max(m, vm.committed || 0), 0)
                  const requiredBytes = maxCommitted * 2
                  return (
                    <Box>
                      <TextField
                        select
                        fullWidth
                        size="small"
                        label="Temporary Storage"
                        value={migTempStorage}
                        onChange={(e) => setMigTempStorage(e.target.value)}
                        helperText={(() => {
                          const sel = vcenterPreflight.tempStorages.find(s => s.path === migTempStorage)
                          if (!sel) return 'Select where virt-v2v writes temporary files during conversion'
                          const availGB = (sel.availableBytes / 1073741824).toFixed(1)
                          const reqGB = (requiredBytes / 1073741824).toFixed(1)
                          if (requiredBytes > 0 && sel.availableBytes < requiredBytes) return `Insufficient space: ${availGB} GB available, ~${reqGB} GB required for largest VM in batch`
                          return requiredBytes > 0
                            ? `${availGB} GB available (${sel.filesystem}), ~${reqGB} GB peak needed per VM`
                            : `${availGB} GB available (${sel.filesystem})`
                        })()}
                        error={(() => {
                          const sel = vcenterPreflight.tempStorages.find(s => s.path === migTempStorage)
                          return sel && requiredBytes > 0 ? sel.availableBytes < requiredBytes : false
                        })()}
                      >
                        {vcenterPreflight.tempStorages.map(s => {
                          const usedPct = Math.round(((s.totalBytes - s.availableBytes) / s.totalBytes) * 100)
                          const availGB = (s.availableBytes / 1073741824).toFixed(1)
                          const totalGB = (s.totalBytes / 1073741824).toFixed(1)
                          return (
                            <MenuItem key={s.path} value={s.path}>
                              <Box sx={{ width: '100%' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                  <i className="ri-hard-drive-2-line" style={{ fontSize: 14, opacity: 0.5 }} />
                                  <Typography variant="body2" sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}>{s.path}</Typography>
                                  <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>
                                    {availGB} / {totalGB} GB free
                                  </Typography>
                                </Box>
                                <LinearProgress
                                  variant="determinate"
                                  value={usedPct}
                                  sx={{
                                    height: 4,
                                    borderRadius: 2,
                                    bgcolor: 'action.hover',
                                    '& .MuiLinearProgress-bar': {
                                      bgcolor: usedPct > 90 ? 'error.main' : usedPct > 70 ? 'warning.main' : 'success.main',
                                      borderRadius: 2,
                                    }
                                  }}
                                />
                              </Box>
                            </MenuItem>
                          )
                        })}
                      </TextField>
                    </Box>
                  )
                })()}

                <FormControlLabel
                  control={<Switch size="small" checked={migStartAfter} onChange={(_, v) => setMigStartAfter(v)} />}
                  label={<Typography variant="body2">{t('inventoryPage.esxiMigration.startAfterMigration')}</Typography>}
                />

                {/* SSH warning — not needed for vCenter */}
                {bulkMigHostInfo?.hostType !== 'vcenter' && bulkMigHostInfo?.hostType !== 'hyperv' && bulkMigHostInfo?.hostType !== 'nutanix' && migTargetConn && !migPveConnections.find((c: any) => c.id === migTargetConn)?.sshEnabled && (
                  <Alert severity="error" sx={{ fontSize: 12 }} icon={<i className="ri-ssh-line" style={{ fontSize: 18 }} />}>{t('inventoryPage.esxiMigration.sshRequired')}</Alert>
                )}

                {migType === 'cold' && bulkMigHostInfo?.vms && (() => {
                  const runningVms = bulkMigHostInfo.vms.filter((vm: any) => bulkMigSelected.has(vm.vmid) && (vm.status === 'running' || vm.status === 'poweredOn'))
                  return runningVms.length > 0 ? (
                    <Alert severity="warning" sx={{ fontSize: 12 }}>
                      {t('inventoryPage.esxiMigration.coldMigrationRunningVms')}
                      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
                        {runningVms.map((vm: any) => (
                          <li key={vm.vmid}><strong>{vm.name || vm.vmid}</strong></li>
                        ))}
                      </Box>
                    </Alert>
                  ) : null
                })()}
                {migType === 'live' && bulkMigHostInfo?.vms && (() => {
                  const stoppedVms = bulkMigHostInfo.vms.filter((vm: any) => bulkMigSelected.has(vm.vmid) && vm.status !== 'running' && vm.status !== 'poweredOn')
                  return stoppedVms.length > 0 ? (
                    <Alert severity="warning" sx={{ fontSize: 12 }}>
                      Live migration requires the source VM to be running (so VMware can snapshot + quiesce the guest).
                      The following selected VM(s) are not running. Start them first, or switch the batch to Offline migration:
                      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
                        {stoppedVms.map((vm: any) => (
                          <li key={vm.vmid}><strong>{vm.name || vm.vmid}</strong> ({vm.status || 'stopped'})</li>
                        ))}
                      </Box>
                    </Alert>
                  ) : null
                })()}
                {/* Live + Windows guests without running VMware Tools: VSS quiesce
                    won't run so the snapshot will be crash-consistent and virt-v2v
                    will fail on the dirty NTFS mid-conversion. Surface the offenders
                    upfront rather than wasting download time. */}
                {migType === 'live' && bulkMigHostInfo?.vms && (() => {
                  const winNoTools = bulkMigHostInfo.vms.filter((vm: any) =>
                    bulkMigSelected.has(vm.vmid) &&
                    (vm.status === 'running' || vm.status === 'poweredOn') &&
                    (vm.guest_OS || vm.guestOS || '').toString().toLowerCase().includes('windows') &&
                    vm.toolsRunningStatus !== 'guestToolsRunning'
                  )
                  return winNoTools.length > 0 ? (
                    <Alert severity="warning" sx={{ fontSize: 12 }}>
                      Live migration of Windows guests requires VMware Tools installed AND running
                      (VSS quiesce is the only way to capture a clean NTFS snapshot while the VM keeps running).
                      The following selected Windows VM(s) do not have Tools running. Install / repair Tools
                      in each guest and retry, or switch the batch to Offline migration (with
                      <code>powercfg /h off</code> + <code>shutdown /s /f /t 0</code> on each guest):
                      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
                        {winNoTools.map((vm: any) => (
                          <li key={vm.vmid}><strong>{vm.name || vm.vmid}</strong> (toolsStatus={vm.toolsStatus || 'unknown'}, toolsRunningStatus={vm.toolsRunningStatus || 'unknown'})</li>
                        ))}
                      </Box>
                    </Alert>
                  ) : null
                })()}
              </>
            )}

            {/* Bulk migration progress */}
            {bulkMigJobs.length > 0 && (() => {
              const completedCount = bulkMigJobs.filter(j => j.status === 'completed').length
              const failedCount = bulkMigJobs.filter(j => j.status === 'failed').length
              const globalProgress = bulkMigJobs.length > 0 ? Math.round(bulkMigJobs.reduce((sum, j) => sum + j.progress, 0) / bulkMigJobs.length) : 0
              const allDone = bulkMigJobs.every(j => ['completed', 'failed', 'cancelled'].includes(j.status))
              const allLogs = (bulkMigLogsFilter
                ? bulkMigJobs.filter(j => j.jobId === bulkMigLogsFilter)
                : bulkMigJobs
              ).flatMap(j => (j.logs || []).map(l => ({ ...l, vmName: j.name }))).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
              return (
                <Stack spacing={1}>
                  {/* Global progress header — collapsible */}
                  <Box
                    onClick={() => setBulkMigProgressExpanded(v => !v)}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', userSelect: 'none', py: 0.5 }}
                  >
                    <i className={bulkMigProgressExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 18, opacity: 0.5 }} />
                    <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ flex: 1 }}>
                      {t('inventoryPage.esxiMigration.bulkMigration')} — {completedCount}/{bulkMigJobs.length} {t('inventoryPage.esxiMigration.completed').toLowerCase()}
                      {failedCount > 0 && <Typography component="span" color="error.main" fontWeight={700} fontSize={12}> ({failedCount} {t('inventoryPage.esxiMigration.failed').toLowerCase()})</Typography>}
                    </Typography>
                    <Typography variant="caption" fontWeight={700} sx={{ opacity: 0.6 }}>{globalProgress}%</Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={globalProgress}
                    color={allDone ? (failedCount > 0 ? 'error' : 'success') : 'primary'}
                    sx={{ height: 6, borderRadius: 3 }}
                  />

                  {/* Individual jobs — shown when expanded.
                      Each row reuses the source-logo → animated-flow → Proxmox-logo
                      visual from the single-VM modal (search "migFlow" above), but
                      shrunk to fit a list row. The flowing dots are rendered ONLY
                      for the job(s) currently transferring/converting; queued jobs
                      show a paused icon, completed jobs show a solid green line,
                      failed jobs show a red cross. This makes it obvious at a glance
                      WHICH VM is actively moving without parsing the chip text. */}
                  {bulkMigProgressExpanded && (() => {
                    // Resolve the source hypervisor logo once for the whole batch
                    // (every VM in the batch shares the same source connection).
                    const srcLogo =
                      bulkMigHostInfo?.hostType === 'hyperv' ? '/images/hyperv-logo.svg' :
                      bulkMigHostInfo?.hostType === 'nutanix' ? '/images/nutanix-logo.svg' :
                      bulkMigHostInfo?.hostType === 'xcpng' ? '/images/xcpng-logo.svg' :
                      '/images/esxi-logo.svg'
                    const dstLogo = theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'
                    return (
                      <Box sx={{ pl: 1 }}>
                        {bulkMigJobs.map((job) => {
                          const isDone = job.status === 'completed'
                          const isFailed = job.status === 'failed' || job.status === 'cancelled'
                          const isQueued = job.status === 'queued'
                          const isActive = !isDone && !isFailed && !isQueued
                          return (
                            <Box key={job.vmid} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
                              {/* Source hypervisor logo */}
                              <Box sx={{
                                width: 24, height: 24, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                                border: '1px solid', borderColor: isDone ? 'success.main' : isFailed ? 'error.main' : 'divider',
                                opacity: isQueued ? 0.4 : 1,
                              }}>
                                <img src={srcLogo} alt="" width={14} height={14} style={{ opacity: isDone ? 0.4 : 1 }} />
                              </Box>
                              {/* Animated flow track (dots flow only for the active job).
                                  Same migFlow keyframe as the single-VM upper block;
                                  duration/spacing are slightly tighter to match the
                                  smaller track length. */}
                              <Box sx={{ width: 70, position: 'relative', height: 16, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                <Box sx={{ position: 'absolute', inset: 0, top: '50%', height: 2, transform: 'translateY(-50%)', bgcolor: isDone ? 'success.main' : isFailed ? 'error.main' : 'divider', borderRadius: 1, opacity: isQueued ? 0.3 : 1 }} />
                                {isActive && [0, 1, 2, 3].map(idx => (
                                  <Box key={idx} sx={{
                                    position: 'absolute', width: 5, height: 5, borderRadius: '50%',
                                    bgcolor: 'primary.main',
                                    animation: 'migFlowBulk 1.6s ease-in-out infinite',
                                    animationDelay: `${idx * 0.4}s`,
                                    opacity: 0,
                                    '@keyframes migFlowBulk': {
                                      '0%': { left: '0%', opacity: 0, transform: 'scale(0.5)' },
                                      '15%': { opacity: 1, transform: 'scale(1)' },
                                      '85%': { opacity: 1, transform: 'scale(1)' },
                                      '100%': { left: '100%', opacity: 0, transform: 'scale(0.5)' },
                                    },
                                  }} />
                                ))}
                                {isFailed && (
                                  <Box sx={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', color: 'error.main', fontSize: 14, lineHeight: 1 }}>
                                    <i className="ri-close-circle-fill" />
                                  </Box>
                                )}
                                {isQueued && (
                                  <Box sx={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', color: 'text.disabled', fontSize: 12, lineHeight: 1 }}>
                                    <i className="ri-pause-circle-line" />
                                  </Box>
                                )}
                              </Box>
                              {/* Proxmox logo */}
                              <Box sx={{
                                width: 24, height: 24, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                                border: '1px solid', borderColor: isDone ? 'success.main' : isFailed ? 'error.main' : 'divider',
                                opacity: isQueued ? 0.4 : 1,
                              }}>
                                <img src={dstLogo} alt="" width={14} height={14} style={{ opacity: isDone ? 1 : 0.6 }} />
                              </Box>
                              {/* VM name + thin progress bar */}
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="body2" fontWeight={600} fontSize={12} noWrap>{job.name}</Typography>
                                <LinearProgress
                                  variant={job.status === 'pending' ? 'indeterminate' : 'determinate'}
                                  value={isQueued ? 0 : job.progress}
                                  color={isDone ? 'success' : isFailed ? 'error' : 'primary'}
                                  sx={{ height: 4, borderRadius: 2, mt: 0.5, ...(isQueued ? { opacity: 0.3 } : {}) }}
                                />
                              </Box>
                              <Chip
                                size="small"
                                label={isDone ? t('inventoryPage.esxiMigration.completed') : isFailed ? t('inventoryPage.esxiMigration.failed') : isQueued ? t('inventoryPage.esxiMigration.queued') : `${job.progress}%`}
                                sx={{
                                  height: 20, fontSize: 10, fontWeight: 700, minWidth: 50,
                                  bgcolor: isDone ? 'success.main' : isFailed ? 'error.main' : isQueued ? 'action.disabled' : 'primary.main',
                                  color: '#fff',
                                }}
                              />
                            </Box>
                          )
                        })}
                      </Box>
                    )
                  })()}

                  {/* Logs section — collapsible */}
                  <Box
                    onClick={() => setBulkMigLogsExpanded(v => !v)}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', userSelect: 'none', py: 0.5, mt: 1 }}
                  >
                    <i className={bulkMigLogsExpanded ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 18, opacity: 0.5 }} />
                    <Typography variant="body2" fontWeight={700} fontSize={12}>
                      {t('inventoryPage.esxiMigration.migrationLogs')}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ opacity: 0.4 }}>({allLogs.length})</Typography>
                  </Box>

                  {bulkMigLogsExpanded && (
                    <Box>
                      {/* VM filter tabs */}
                      {bulkMigJobs.length > 1 && (
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                          <Chip
                            size="small"
                            label={t('inventoryPage.esxiMigration.allVms')}
                            onClick={() => setBulkMigLogsFilter(null)}
                            sx={{ height: 22, fontSize: 10, fontWeight: 600, bgcolor: !bulkMigLogsFilter ? 'primary.main' : 'action.hover', color: !bulkMigLogsFilter ? '#fff' : 'text.secondary' }}
                          />
                          {bulkMigJobs.filter(j => j.jobId).map(j => (
                            <Chip
                              key={j.jobId}
                              size="small"
                              label={j.name}
                              onClick={() => setBulkMigLogsFilter(bulkMigLogsFilter === j.jobId ? null : j.jobId)}
                              sx={{ height: 22, fontSize: 10, fontWeight: 600, bgcolor: bulkMigLogsFilter === j.jobId ? 'primary.main' : 'action.hover', color: bulkMigLogsFilter === j.jobId ? '#fff' : 'text.secondary' }}
                            />
                          ))}
                        </Box>
                      )}

                      {/* Log entries */}
                      <Box sx={{ maxHeight: 250, overflowY: 'auto', bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.03)', borderRadius: 1, p: 1 }}>
                        {allLogs.length > 0 ? allLogs.map((log, i) => (
                          <Box key={i} sx={{ display: 'flex', gap: 0.75, py: 0.25, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, lineHeight: 1.5 }}>
                            <Typography component="span" sx={{ fontSize: 10, opacity: 0.4, whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
                              {new Date(log.ts).toLocaleTimeString()}
                            </Typography>
                            <Typography component="span" sx={{ fontSize: 11, fontFamily: 'inherit', color: log.level === 'error' ? 'error.main' : log.level === 'warn' ? 'warning.main' : log.level === 'success' ? 'success.main' : 'text.secondary' }}>
                              {log.level === 'success' ? '✓' : log.level === 'error' ? '✗' : log.level === 'warn' ? '⚠' : '·'}
                            </Typography>
                            {!bulkMigLogsFilter && bulkMigJobs.length > 1 && (
                              <Typography component="span" sx={{ fontSize: 10, fontFamily: 'inherit', fontWeight: 700, opacity: 0.5, whiteSpace: 'nowrap' }}>
                                [{log.vmName}]
                              </Typography>
                            )}
                            <Typography component="span" sx={{ fontSize: 11, fontFamily: 'inherit', color: log.level === 'error' ? 'error.main' : 'text.primary' }}>
                              {log.msg}
                            </Typography>
                          </Box>
                        )) : (
                          <Typography variant="caption" sx={{ opacity: 0.4 }}>
                            {t('inventoryPage.esxiMigration.logsWillAppear')}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  )}
                </Stack>
              )
            })()}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {bulkMigJobs.length === 0 ? (
            <>
              <Button onClick={() => setBulkMigOpen(false)} disabled={bulkMigStarting}>{t('common.cancel')}</Button>
              <Button
                variant="outlined"
                disabled={(() => {
                  if (!migTargetConn || !migTargetNode || !migTargetStorage || bulkMigStarting) return true
                  const isV2vSource = bulkMigHostInfo?.hostType === 'vcenter' || bulkMigHostInfo?.hostType === 'hyperv' || bulkMigHostInfo?.hostType === 'nutanix'
                  if (isV2vSource) {
                    if (vcenterPreflight?.checked) {
                      if (!vcenterPreflight.virtV2vInstalled) return true
                      if (!vcenterPreflight.nbdkitInstalled) return true
                      if (!vcenterPreflight.nbdcopyInstalled) return true
                      if (!vcenterPreflight.guestfsToolsInstalled) return true
                      if (!vcenterPreflight.ovmfInstalled) return true
                      // In bulk, block if batch contains Windows VMs and virtio-win is missing
                      if (!vcenterPreflight.virtioWinInstalled) {
                        const hasWin = (bulkMigHostInfo?.vms || [])
                          .filter((vm: any) => bulkMigSelected.has(vm.vmid))
                          .some((vm: any) => (vm.guest_OS || vm.guestOS || '').toString().toLowerCase().includes('win'))
                        if (hasWin) return true
                      }
                    }
                  } else {
                    if (migTargetConn && !migPveConnections.find((c: any) => c.id === migTargetConn)?.sshEnabled) return true
                    if (migSshfsAvailable === false && (migTransferMode === 'sshfs' || migType === 'sshfs_boot')) return true
                  }
                  // Batch-wide power-state gates. The inner Alerts list the offending
                  // VMs individually; here we just return true so the button is disabled
                  // whenever the batch mixes the chosen migrationType with an incompatible
                  // VM state.
                  if (migType === 'cold' && bulkMigHostInfo?.vms?.some((vm: any) => bulkMigSelected.has(vm.vmid) && (vm.status === 'running' || vm.status === 'poweredOn'))) return true
                  if (migType === 'live' && bulkMigHostInfo?.vms?.some((vm: any) => bulkMigSelected.has(vm.vmid) && vm.status !== 'running' && vm.status !== 'poweredOn')) return true
                  // Live + Windows in the batch without running VMware Tools: block
                  // (symmetric with the individual modal check).
                  if (migType === 'live' && bulkMigHostInfo?.vms?.some((vm: any) =>
                    bulkMigSelected.has(vm.vmid) &&
                    (vm.status === 'running' || vm.status === 'poweredOn') &&
                    (vm.guest_OS || vm.guestOS || '').toString().toLowerCase().includes('windows') &&
                    vm.toolsRunningStatus !== 'guestToolsRunning'
                  )) return true
                  return false
                })()}
                sx={{ textTransform: 'none' }}
                startIcon={bulkMigStarting ? <CircularProgress size={16} color="inherit" /> : <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={16} height={16} />}
                onClick={async () => {
                  if (!bulkMigHostInfo) return
                  setBulkMigStarting(true)
                  const vmsToMigrate = bulkMigHostInfo.vms.filter((vm: any) => bulkMigSelected.has(vm.vmid))
                  // Build node list for round-robin distribution.
                  // - Auto mode: spread across every online node of the CHOSEN cluster
                  //   (migTargetConn). We filter migNodeOptions by connId + online
                  //   status so a degraded/offline node in the cluster doesn't get
                  //   jobs round-robined to it.
                  // - Manual mode: single target node, every job lands there.
                  let nodeList: string[]
                  if (migTargetNode === '__auto__') {
                    const clusterNodes = migNodeOptions
                      .filter((o: any) => o.connId === migTargetConn && o.status === 'online')
                      .map((o: any) => o.node)
                    // Fallback: if status info missing/empty, take all nodes of the
                    // cluster so we at least try instead of skipping the whole batch.
                    nodeList = clusterNodes.length > 0
                      ? clusterNodes
                      : migNodeOptions.filter((o: any) => o.connId === migTargetConn).map((o: any) => o.node)
                  } else {
                    nodeList = [migTargetNode]
                  }
                  if (nodeList.length === 0) {
                    setBulkMigStarting(false)
                    return
                  }

                  // Create all jobs, first N as 'pending' (will be started), rest as 'queued'.
                  // We carry the vCenter inventory path on each job so it can be threaded
                  // through the per-VM POST below; bulk migrations may span multiple hosts
                  // inside the same vCenter so the path can differ per VM.
                  const jobs: typeof bulkMigJobs = vmsToMigrate.map((vm: any, idx: number) => ({
                    vmid: vm.vmid,
                    name: vm.name || vm.vmid,
                    jobId: '',
                    status: idx < BULK_MIG_CONCURRENCY ? 'pending' : 'queued',
                    progress: 0,
                    targetNode: nodeList[idx % nodeList.length],
                    vcenterDatacenter: vm.vcenterDatacenter,
                    vcenterCluster: vm.vcenterCluster,
                    vcenterHost: vm.vcenterHost,
                  } as any))

                  // Start the first batch
                  const isVcenterBulk = bulkMigHostInfo.hostType === 'vcenter'
                  const isHypervBulk = bulkMigHostInfo.hostType === 'hyperv'
                  const isNutanixBulk = bulkMigHostInfo.hostType === 'nutanix'
                  const sourceType = bulkMigHostInfo.hostType === 'xcpng' ? 'XCP-ng' : isVcenterBulk ? 'vCenter' : isHypervBulk ? 'Hyper-V' : isNutanixBulk ? 'Nutanix' : 'ESXi'
                  for (let idx = 0; idx < Math.min(BULK_MIG_CONCURRENCY, jobs.length); idx++) {
                    const job = jobs[idx]
                    try {
                      const res = await fetch('/api/v1/migrations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          sourceConnectionId: bulkMigHostInfo.connectionId,
                          sourceVmId: job.vmid,
                          sourceVmName: job.name,
                          targetConnectionId: migTargetConn,
                          targetNode: job.targetNode,
                          targetStorage: migTargetStorage,
                          networkBridge: migNetworkBridge,
                          // vCenter supports cold + live (NFC-on-snapshot); Hyper-V /
                          // Nutanix still force cold since their pipelines don't have a
                          // snapshot-based transfer path. sshfs_boot is ESXi-direct only.
                          migrationType: (isHypervBulk || isNutanixBulk) ? 'cold'
                            : (isVcenterBulk ? (migType === 'sshfs_boot' ? 'cold' : migType) : migType),
                          transferMode: (isVcenterBulk || isHypervBulk || isNutanixBulk) ? 'v2v' : migTransferMode,
                          startAfterMigration: migStartAfter,
                          // vCenter inventory path required by libvirt vpx URI (auto-discovered
                          // server-side via SOAP). Bulk jobs may target different ESXi hosts
                          // inside the same vCenter, so the path is per-VM. Same rationale
                          // as the single-migration POST: we don't gate on isVcenterBulk
                          // because the bulk host info's hostType isn't reliably 'vcenter'.
                          ...((job as any).vcenterDatacenter && {
                            vcenterDatacenter: (job as any).vcenterDatacenter,
                          }),
                          ...((job as any).vcenterCluster && {
                            vcenterCluster: (job as any).vcenterCluster,
                          }),
                          ...((job as any).vcenterHost && {
                            vcenterHost: (job as any).vcenterHost,
                          }),
                          // tempStorage lets the user pick where virt-v2v writes
                          // temp files. Omit when it's the default /tmp so the
                          // server-side default path is used and we don't
                          // inadvertently pass an empty string.
                          ...((isVcenterBulk || isHypervBulk || isNutanixBulk) && migTempStorage && migTempStorage !== '/tmp' && {
                            tempStorage: migTempStorage,
                          }),
                        }),
                      })
                      const d = await res.json()
                      if (d.data?.jobId) {
                        job.jobId = d.data.jobId
                        job.status = 'pending'
                        addPCTask({
                          id: `migration-${d.data.jobId}`,
                          type: 'generic',
                          label: `${t('inventoryPage.esxiMigration.migrating')} ${job.name} (${sourceType} → Proxmox)`,
                          detail: t('inventoryPage.esxiMigration.preflight'),
                          progress: 0,
                          status: 'running',
                          createdAt: Date.now(),
                        })
                      } else {
                        job.status = 'failed'
                        job.error = d.error || 'Failed to start'
                      }
                    } catch (e: any) {
                      job.status = 'failed'
                      job.error = e.message
                    }
                  }

                  bulkMigConfigRef.current = {
                    sourceConnectionId: bulkMigHostInfo.connectionId,
                    targetConnectionId: migTargetConn,
                    targetStorage: migTargetStorage,
                    networkBridge: migNetworkBridge,
                    migrationType: (isHypervBulk || isNutanixBulk) ? 'cold'
                      : (isVcenterBulk ? (migType === 'sshfs_boot' ? 'cold' : migType) : migType),
                    transferMode: isVcenterBulk ? 'v2v' : migTransferMode,
                    startAfterMigration: migStartAfter,
                    sourceType,
                    // Persisted across the queued-job poller so retries use the
                    // same temp storage the user selected when starting the batch.
                    ...((isVcenterBulk || isHypervBulk || isNutanixBulk) && migTempStorage && migTempStorage !== '/tmp' && {
                      tempStorage: migTempStorage,
                    }),
                  }
                  setBulkMigJobs(jobs)
                  setBulkMigStarting(false)
                }}
              >
                {t('inventoryPage.esxiMigration.startMigration')} ({bulkMigSelected.size} VMs)
              </Button>
            </>
          ) : (
            <>
              <Button
                startIcon={<i className="ri-subtract-line" />}
                onClick={() => setBulkMigOpen(false)}
                sx={{ textTransform: 'none' }}
              >
                {t('inventoryPage.esxiMigration.minimize')}
              </Button>
              {bulkMigJobs.every(j => ['completed', 'failed', 'cancelled'].includes(j.status)) && (
                <Button onClick={() => { setBulkMigOpen(false); setBulkMigJobs([]); setBulkMigSelected(new Set()) }}>
                  {t('common.close')}
                </Button>
              )}
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Enterprise Upgrade Dialog */}
      <Dialog open={upgradeDialogOpen} onClose={() => setUpgradeDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1, pr: 5 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: 'warning.main', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="ri-lock-line" style={{ fontSize: 20, color: '#fff' }} />
          </Box>
          {t('inventoryPage.esxiMigration.enterpriseRequired')}
          <IconButton onClick={() => setUpgradeDialogOpen(false)} sx={{ position: 'absolute', right: 8, top: 8 }}>
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ opacity: 0.8, mb: 2 }}>
            {t('inventoryPage.esxiMigration.enterpriseRequiredDesc')}
          </Typography>
          <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <img src={esxiMigrateVm?.hostType === 'nutanix' ? '/images/nutanix-logo.svg' : esxiMigrateVm?.hostType === 'hyperv' ? '/images/hyperv-logo.svg' : esxiMigrateVm?.hostType === 'xcpng' ? '/images/xcpng-logo.svg' : '/images/esxi-logo.svg'} alt="" width={24} height={24} />
              <i className="ri-arrow-right-line" style={{ fontSize: 20, opacity: 0.4 }} />
              <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={24} height={24} />
            </Box>
            <Box>
              <Typography variant="body2" fontWeight={700}>{esxiMigrateVm?.hostType === 'nutanix' ? 'Nutanix' : esxiMigrateVm?.hostType === 'hyperv' ? 'Hyper-V' : esxiMigrateVm?.hostType === 'xcpng' ? 'XCP-ng' : esxiMigrateVm?.hostType === 'vcenter' ? 'vCenter' : 'VMware'} → Proxmox VE</Typography>
              <Typography variant="caption" sx={{ opacity: 0.6 }}>Enterprise / Enterprise+</Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            variant="contained"
            color="warning"
            startIcon={<i className="ri-vip-crown-line" />}
            onClick={() => { setUpgradeDialogOpen(false); window.open('https://www.proxcenter.io/', '_blank') }}
            sx={{ textTransform: 'none' }}
          >
            {t('inventoryPage.esxiMigration.upgradePlan')}
          </Button>
        </DialogActions>
      </Dialog>

    </>
  )
}
