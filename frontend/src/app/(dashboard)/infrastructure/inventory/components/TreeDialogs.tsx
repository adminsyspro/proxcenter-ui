'use client'

import React from 'react'
import { useTranslations } from 'next-intl'

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
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Snackbar,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

import EntityTagManager from './EntityTagManager'
import { MigrateVmDialog, CrossClusterMigrateParams } from '@/components/MigrateVmDialog'
import { CloneVmDialog } from '@/components/hardware/CloneVmDialog'
import { NodeIcon, ClusterIcon, getVmIcon } from './TreeIcons'

// RemixIcon replacements used in context menus / dialogs
const PlayArrowIcon = (props: any) => <i className="ri-play-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StopIcon = (props: any) => <i className="ri-stop-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PowerSettingsNewIcon = (props: any) => <i className="ri-shut-down-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PauseIcon = (props: any) => <i className="ri-pause-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const TerminalIcon = (props: any) => <i className="ri-terminal-box-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const MoveUpIcon = (props: any) => <i className="ri-upload-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ContentCopyIcon = (props: any) => <i className="ri-file-copy-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const DescriptionIcon = (props: any) => <i className="ri-file-text-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

// ----- Types used by context menus / dialogs -----

type VmContextMenu = {
  mouseX: number
  mouseY: number
  connId: string
  node: string
  type: string
  vmid: string
  name: string
  status?: string
  isCluster: boolean
  template?: boolean
  sshEnabled?: boolean
} | null

type NodeContextMenu = {
  mouseX: number
  mouseY: number
  connId: string
  node: string
  maintenance?: string
  sshEnabled?: boolean
} | null

type TreeCluster = {
  connId: string
  name: string
  isCluster: boolean
  cephHealth?: string
  sshEnabled?: boolean
  nodes: {
    node: string
    status?: string
    ip?: string
    maintenance?: string
    cpu?: number
    mem?: number
    maxmem?: number
    vms: { type: string; vmid: string; name: string; status?: string; cpu?: number; mem?: number; maxmem?: number; disk?: number; maxdisk?: number; uptime?: number; pool?: string; tags?: string; template?: boolean; hastate?: string; hagroup?: string }[]
  }[]
}

export interface TreeDialogsProps {
  // VM context menu
  contextMenu: VmContextMenu
  handleCloseContextMenu: () => void
  actionBusy: boolean
  handleVmAction: (action: string) => void
  unlocking: boolean

  // VM action confirmation dialog
  vmActionConfirm: { action: string; name: string } | null
  setVmActionConfirm: React.Dispatch<React.SetStateAction<{ action: string; name: string } | null>>
  executeVmAction: (action: string) => void

  // VM action error dialog
  vmActionError: string | null
  setVmActionError: React.Dispatch<React.SetStateAction<string | null>>

  // Clone
  cloneDialogOpen: boolean
  setCloneDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  cloneTarget: VmContextMenu
  setCloneTarget: React.Dispatch<React.SetStateAction<VmContextMenu>>
  handleCloneVm: (params: { targetNode: string; newVmid: number; name: string; targetStorage?: string; format?: string; pool?: string; full: boolean }) => Promise<void>
  allVms: { vmid: string; [key: string]: any }[]

  // Template conversion
  templateDialogOpen: boolean
  setTemplateDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  templateTarget: VmContextMenu
  setTemplateTarget: React.Dispatch<React.SetStateAction<VmContextMenu>>
  convertingTemplate: boolean
  handleConvertToTemplate: () => Promise<void>

  // Migrate
  migrateDialogOpen: boolean
  setMigrateDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  migrateTarget: VmContextMenu
  setMigrateTarget: React.Dispatch<React.SetStateAction<VmContextMenu>>
  setReloadTick: React.Dispatch<React.SetStateAction<number>>

  // Snapshot
  snapshotDialogOpen: boolean
  setSnapshotDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  snapshotTarget: { connId: string; type: string; node: string; vmid: string } | null
  setSnapshotTarget: React.Dispatch<React.SetStateAction<{ connId: string; type: string; node: string; vmid: string } | null>>
  snapshotName: string
  setSnapshotName: React.Dispatch<React.SetStateAction<string>>
  snapshotDesc: string
  setSnapshotDesc: React.Dispatch<React.SetStateAction<string>>
  snapshotVmstate: boolean
  setSnapshotVmstate: React.Dispatch<React.SetStateAction<boolean>>
  creatingSnapshot: boolean
  executeSnapshot: () => Promise<void>

  // Backup
  backupDialogOpen: boolean
  setBackupDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  backupTarget: { connId: string; type: string; node: string; vmid: string; name: string } | null
  setBackupTarget: React.Dispatch<React.SetStateAction<{ connId: string; type: string; node: string; vmid: string; name: string } | null>>
  backupStorages: any[]
  backupStorage: string
  setBackupStorage: React.Dispatch<React.SetStateAction<string>>
  backupMode: string
  setBackupMode: React.Dispatch<React.SetStateAction<string>>
  backupCompress: string
  setBackupCompress: React.Dispatch<React.SetStateAction<string>>
  backupLoading: boolean
  executeBackupNow: () => Promise<void>

  // Snackbar
  snackbar: { open: boolean; message: string; severity: 'success' | 'error' | 'info' }
  setSnackbar: React.Dispatch<React.SetStateAction<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>>

  // Unlock error dialog
  unlockErrorDialog: { open: boolean; error: string; hint?: string }
  setUnlockErrorDialog: React.Dispatch<React.SetStateAction<{ open: boolean; error: string; hint?: string }>>

  // Shell dialog
  shellDialog: { open: boolean; connId: string; node: string; loading: boolean; data: any | null; error: string | null }
  setShellDialog: React.Dispatch<React.SetStateAction<{ open: boolean; connId: string; node: string; loading: boolean; data: any | null; error: string | null }>>

  // Tag management dialog
  tagDialog: { type: 'connection' | 'host'; entityId: string; connId?: string; node?: string; name: string; nodeStatus?: string; nodeMaintenance?: string; clusterNodes?: { status?: string }[] } | null
  setTagDialog: React.Dispatch<React.SetStateAction<{ type: 'connection' | 'host'; entityId: string; connId?: string; node?: string; name: string; nodeStatus?: string; nodeMaintenance?: string; clusterNodes?: { status?: string }[] } | null>>
  tagDialogTags: string[]
  setTagDialogTags: React.Dispatch<React.SetStateAction<string[]>>

  // Cluster context menu
  clusterContextMenu: { mouseX: number; mouseY: number; connId: string; name: string; nodes: { status?: string }[] } | null
  setClusterContextMenu: React.Dispatch<React.SetStateAction<{ mouseX: number; mouseY: number; connId: string; name: string; nodes: { status?: string }[] } | null>>
  openTagDialog: (type: 'connection' | 'host', entityId: string, name: string, connId?: string, node?: string, extra?: { nodeStatus?: string; nodeMaintenance?: string; clusterNodes?: { status?: string }[] }) => void

  // Node context menu
  nodeContextMenu: NodeContextMenu
  handleCloseNodeContextMenu: () => void
  handleMaintenanceClick: () => void
  handleBulkActionClick: (action: 'start-all' | 'shutdown-all' | 'migrate-all') => void
  handleOpenShell: (connId: string, node: string) => void
  onCreateVm?: (connId: string, node: string) => void
  onCreateLxc?: (connId: string, node: string) => void
  onNodeAction?: (connId: string, node: string, action: 'reboot' | 'shutdown') => void
  clusters: TreeCluster[]

  // Maintenance dialog
  maintenanceBusy: boolean
  maintenanceTarget: { connId: string; node: string; maintenance?: string } | null
  setMaintenanceTarget: React.Dispatch<React.SetStateAction<{ connId: string; node: string; maintenance?: string } | null>>
  maintenanceError: string | null
  maintenanceLocalVms: Set<string>
  maintenanceStorageLoading: boolean
  maintenanceMigrateTarget: string
  setMaintenanceMigrateTarget: React.Dispatch<React.SetStateAction<string>>
  maintenanceShutdownLocal: boolean
  setMaintenanceShutdownLocal: React.Dispatch<React.SetStateAction<boolean>>
  maintenanceStep: string | null
  setMaintenanceStep: React.Dispatch<React.SetStateAction<string | null>>
  handleMaintenanceConfirm: () => Promise<void>
  getNodeVms: (connId: string, nodeName: string) => any[]
  getOtherNodes: (connId: string, nodeName: string) => string[]

  // Bulk action dialog
  bulkActionDialog: { open: boolean; action: 'start-all' | 'shutdown-all' | 'migrate-all' | null; connId: string; node: string; targetNode: string }
  setBulkActionDialog: React.Dispatch<React.SetStateAction<{ open: boolean; action: 'start-all' | 'shutdown-all' | 'migrate-all' | null; connId: string; node: string; targetNode: string }>>
  bulkActionBusy: boolean
  handleBulkActionConfirm: () => Promise<void>

  // Snapshot handler
  handleTakeSnapshot: () => void
  // Backup handler
  handleBackupNow: () => Promise<void>
  // Console handler
  handleOpenConsole: () => void
  // Unlock handler
  handleUnlock: () => Promise<void>
}

export default function TreeDialogs(props: TreeDialogsProps) {
  const t = useTranslations()

  const {
    contextMenu, handleCloseContextMenu, actionBusy, handleVmAction, unlocking,
    vmActionConfirm, setVmActionConfirm, executeVmAction,
    vmActionError, setVmActionError,
    cloneDialogOpen, setCloneDialogOpen, cloneTarget, setCloneTarget, handleCloneVm, allVms,
    templateDialogOpen, setTemplateDialogOpen, templateTarget, setTemplateTarget, convertingTemplate, handleConvertToTemplate,
    migrateDialogOpen, setMigrateDialogOpen, migrateTarget, setMigrateTarget, setReloadTick,
    snapshotDialogOpen, setSnapshotDialogOpen, snapshotTarget, setSnapshotTarget,
    snapshotName, setSnapshotName, snapshotDesc, setSnapshotDesc, snapshotVmstate, setSnapshotVmstate,
    creatingSnapshot, executeSnapshot,
    backupDialogOpen, setBackupDialogOpen, backupTarget, setBackupTarget,
    backupStorages, backupStorage, setBackupStorage, backupMode, setBackupMode,
    backupCompress, setBackupCompress, backupLoading, executeBackupNow,
    snackbar, setSnackbar,
    unlockErrorDialog, setUnlockErrorDialog,
    shellDialog, setShellDialog,
    tagDialog, setTagDialog, tagDialogTags, setTagDialogTags,
    clusterContextMenu, setClusterContextMenu, openTagDialog,
    nodeContextMenu, handleCloseNodeContextMenu, handleMaintenanceClick, handleBulkActionClick, handleOpenShell,
    onCreateVm, onCreateLxc, onNodeAction, clusters,
    maintenanceBusy, maintenanceTarget, setMaintenanceTarget, maintenanceError, maintenanceLocalVms,
    maintenanceStorageLoading, maintenanceMigrateTarget, setMaintenanceMigrateTarget,
    maintenanceShutdownLocal, setMaintenanceShutdownLocal, maintenanceStep, setMaintenanceStep,
    handleMaintenanceConfirm, getNodeVms, getOtherNodes,
    bulkActionDialog, setBulkActionDialog, bulkActionBusy, handleBulkActionConfirm,
    handleTakeSnapshot, handleBackupNow, handleOpenConsole, handleUnlock,
  } = props

  return (
    <>
      {/* Menu contextuel VM */}
      <Menu
        open={contextMenu !== null}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
        slotProps={{ paper: { sx: { minWidth: 200, '& .MuiListItemIcon-root': { minWidth: 32 } } } }}
      >
        {/* Header du menu */}
        <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {contextMenu && (
              <i
                className={getVmIcon(contextMenu.type, contextMenu.template)}
                style={{ fontSize: 14, opacity: 0.5 }}
              />
            )}
            <Typography variant="body2" sx={{ opacity: 0.7 }}>
              {contextMenu?.name}
            </Typography>
          </Box>
        </Box>

        {/* Menu pour TEMPLATE */}
        {contextMenu?.template && (
          <MenuItem
            onClick={() => {
              setCloneTarget(contextMenu)
              setCloneDialogOpen(true)
              handleCloseContextMenu()
            }}
            disabled={actionBusy}
          >
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" sx={{ color: 'primary.main' }} />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.clone')}</ListItemText>
          </MenuItem>
        )}

        {/* Actions de contrôle pour VM normale */}
        {!contextMenu?.template && [
          /* --- Power actions --- */
          <MenuItem
            key="start"
            onClick={() => handleVmAction('start')}
            disabled={actionBusy || contextMenu?.status === 'running'}
          >
            <ListItemIcon>
              <i className="ri-play-fill" style={{ fontSize: 18, color: '#4caf50' }} />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.start')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="pause"
            onClick={() => handleVmAction('suspend')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <i className="ri-pause-fill" style={{ fontSize: 18, color: '#2196f3' }} />
            </ListItemIcon>
            <ListItemText>{t('inventory.pause')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="hibernate"
            onClick={() => handleVmAction('hibernate')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <i className="ri-zzz-line" style={{ fontSize: 18, color: '#2196f3' }} />
            </ListItemIcon>
            <ListItemText>{t('inventory.hibernate')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="shutdown"
            onClick={() => handleVmAction('shutdown')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <i className="ri-shut-down-line" style={{ fontSize: 18, color: '#ff9800' }} />
            </ListItemIcon>
            <ListItemText>{t('inventoryPage.shutdownClean')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="stop"
            onClick={() => handleVmAction('stop')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <i className="ri-stop-fill" style={{ fontSize: 18, color: '#f44336' }} />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.stop')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="reboot"
            onClick={() => handleVmAction('reboot')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <i className="ri-restart-line" style={{ fontSize: 18, color: '#ff9800' }} />
            </ListItemIcon>
            <ListItemText>{t('inventory.reboot')}</ListItemText>
          </MenuItem>,

          <MenuItem
            key="reset"
            onClick={() => handleVmAction('reset')}
            disabled={actionBusy || contextMenu?.status !== 'running'}
          >
            <ListItemIcon>
              <i className="ri-loop-left-line" style={{ fontSize: 18, color: '#f44336' }} />
            </ListItemIcon>
            <ListItemText>{t('inventory.reset')}</ListItemText>
          </MenuItem>,

          <Divider key="divider1" />,

          /* --- Clone / Template --- */
          <MenuItem
            key="clone"
            onClick={() => {
              setCloneTarget(contextMenu)
              setCloneDialogOpen(true)
              handleCloseContextMenu()
            }}
            disabled={actionBusy}
          >
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('audit.actions.clone')}</ListItemText>
          </MenuItem>,

          <MenuItem key="template" onClick={() => {
            setTemplateTarget(contextMenu)
            setTemplateDialogOpen(true)
            handleCloseContextMenu()
          }} disabled={actionBusy || contextMenu?.status === 'running'}>
            <ListItemIcon>
              <DescriptionIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('templates.convertToTemplate')}</ListItemText>
          </MenuItem>,

          <Divider key="divider2" />,

          /* --- Snapshot / Backup --- */
          <MenuItem key="snapshot" onClick={handleTakeSnapshot} disabled={actionBusy}>
            <ListItemIcon>
              <i className="ri-camera-line" style={{ fontSize: 20 }} />
            </ListItemIcon>
            <ListItemText>{t('inventory.takeSnapshot')}</ListItemText>
          </MenuItem>,

          <MenuItem key="backup" onClick={handleBackupNow} disabled={actionBusy}>
            <ListItemIcon>
              <i className="ri-save-line" style={{ fontSize: 20 }} />
            </ListItemIcon>
            <ListItemText>{t('inventory.backupNow')}</ListItemText>
          </MenuItem>,

          <Divider key="divider3" />,

          /* --- Console / Migrate / Unlock --- */
          contextMenu?.isCluster ? (
            <MenuItem
              key="migrate"
              onClick={() => {
                setMigrateTarget(contextMenu)
                setMigrateDialogOpen(true)
                handleCloseContextMenu()
              }}
              disabled={actionBusy}
            >
              <ListItemIcon>
                <MoveUpIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t('audit.actions.migrate')}</ListItemText>
            </MenuItem>
          ) : null,

          <MenuItem key="console" onClick={handleOpenConsole} disabled={actionBusy}>
            <ListItemIcon>
              <TerminalIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('inventory.console')}</ListItemText>
          </MenuItem>,

          contextMenu?.sshEnabled ? (
            <MenuItem key="unlock" onClick={handleUnlock} disabled={actionBusy || unlocking}>
              <ListItemIcon>
                <i className="ri-lock-unlock-line" style={{ fontSize: 20, color: '#f59e0b' }} />
              </ListItemIcon>
              <ListItemText>{t('inventory.unlock')}</ListItemText>
            </MenuItem>
          ) : null
        ]}
      </Menu>

      {/* Menu contextuel Cluster */}
      <Menu
        open={clusterContextMenu !== null}
        onClose={() => setClusterContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          clusterContextMenu !== null
            ? { top: clusterContextMenu.mouseY, left: clusterContextMenu.mouseX }
            : undefined
        }
        slotProps={{ paper: { sx: { minWidth: 200, '& .MuiListItemIcon-root': { minWidth: 32 } } } }}
      >
        <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <ClusterIcon nodes={clusterContextMenu?.nodes || []} size={14} />
            <Typography variant="body2" sx={{ opacity: 0.7 }}>
              {clusterContextMenu?.name}
            </Typography>
          </Box>
        </Box>
        <MenuItem onClick={() => {
          if (clusterContextMenu) openTagDialog('connection', clusterContextMenu.connId, clusterContextMenu.name, undefined, undefined, { clusterNodes: clusterContextMenu.nodes })
          setClusterContextMenu(null)
        }}>
          <ListItemIcon sx={{ minWidth: 36 }}>
            <i className="ri-price-tag-3-line" style={{ fontSize: 18 }} />
          </ListItemIcon>
          <ListItemText>{t('inventory.manageTags', { defaultMessage: 'Manage Tags' })}</ListItemText>
        </MenuItem>
      </Menu>

      {/* Menu contextuel Node (maintenance) */}
      <Menu
        open={nodeContextMenu !== null}
        onClose={handleCloseNodeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          nodeContextMenu !== null
            ? { top: nodeContextMenu.mouseY, left: nodeContextMenu.mouseX }
            : undefined
        }
        slotProps={{ paper: { sx: { minWidth: 200, '& .MuiListItemIcon-root': { minWidth: 32 } } } }}
      >
        <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <NodeIcon status={(() => {
              if (!nodeContextMenu) return 'online'
              const clu = clusters.find(c => c.connId === nodeContextMenu.connId)
              const n = clu?.nodes.find(n => n.node === nodeContextMenu.node)
              return n?.status || 'online'
            })()} maintenance={nodeContextMenu?.maintenance} size={14} />
            <Typography variant="body2" sx={{ opacity: 0.7 }}>
              {nodeContextMenu?.node}
            </Typography>
          </Box>
        </Box>
        {onCreateVm && (
          <MenuItem onClick={() => {
            if (nodeContextMenu) onCreateVm(nodeContextMenu.connId, nodeContextMenu.node)
            handleCloseNodeContextMenu()
          }}>
            <ListItemIcon sx={{ minWidth: 36 }}>
              <i className="ri-computer-line" style={{ fontSize: 18, color: '#3b82f6' }} />
            </ListItemIcon>
            <ListItemText>{t('inventory.createVm.title')}</ListItemText>
          </MenuItem>
        )}
        {onCreateLxc && (
          <MenuItem onClick={() => {
            if (nodeContextMenu) onCreateLxc(nodeContextMenu.connId, nodeContextMenu.node)
            handleCloseNodeContextMenu()
          }}>
            <ListItemIcon sx={{ minWidth: 36 }}>
              <i className="ri-instance-line" style={{ fontSize: 18, color: '#a855f7' }} />
            </ListItemIcon>
            <ListItemText>{t('inventory.createLxc.title')}</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => {
          if (nodeContextMenu) handleOpenShell(nodeContextMenu.connId, nodeContextMenu.node)
          handleCloseNodeContextMenu()
        }}>
          <ListItemIcon sx={{ minWidth: 36 }}>
            <i className="ri-terminal-box-line" style={{ fontSize: 18 }} />
          </ListItemIcon>
          <ListItemText>{t('inventory.tabShell')}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => handleBulkActionClick('start-all')}>
          <ListItemIcon sx={{ minWidth: 36 }}>
            <PlayArrowIcon fontSize="small" sx={{ color: 'success.main' }} />
          </ListItemIcon>
          <ListItemText>{t('bulkActions.startAllVms')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleBulkActionClick('shutdown-all')}>
          <ListItemIcon sx={{ minWidth: 36 }}>
            <PowerSettingsNewIcon fontSize="small" sx={{ color: 'warning.main' }} />
          </ListItemIcon>
          <ListItemText>{t('bulkActions.shutdownAllVms')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleBulkActionClick('migrate-all')}>
          <ListItemIcon sx={{ minWidth: 36 }}>
            <MoveUpIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('bulkActions.migrateAllVms')}</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem onClick={() => {
          if (nodeContextMenu) onNodeAction?.(nodeContextMenu.connId, nodeContextMenu.node, 'reboot')
          handleCloseNodeContextMenu()
        }}>
          <ListItemIcon sx={{ minWidth: 36 }}>
            <i className="ri-restart-line" style={{ fontSize: 18, color: '#f59e0b' }} />
          </ListItemIcon>
          <ListItemText>{t('inventory.nodeReboot')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => {
          if (nodeContextMenu) onNodeAction?.(nodeContextMenu.connId, nodeContextMenu.node, 'shutdown')
          handleCloseNodeContextMenu()
        }}>
          <ListItemIcon sx={{ minWidth: 36 }}>
            <i className="ri-shut-down-line" style={{ fontSize: 18, color: '#c62828' }} />
          </ListItemIcon>
          <ListItemText>{t('inventory.nodeShutdown')}</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem
          onClick={nodeContextMenu?.sshEnabled ? handleMaintenanceClick : undefined}
          disabled={maintenanceBusy || !nodeContextMenu?.sshEnabled}
          sx={!nodeContextMenu?.sshEnabled ? { opacity: 0.5 } : undefined}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            <i className={nodeContextMenu?.maintenance ? 'ri-play-circle-line' : 'ri-tools-fill'} style={{ fontSize: 20, color: !nodeContextMenu?.sshEnabled ? undefined : nodeContextMenu?.maintenance ? '#4caf50' : '#ff9800' }} />
          </ListItemIcon>
          <ListItemText>
            {nodeContextMenu?.maintenance ? t('inventory.exitMaintenance') : t('inventory.enterMaintenance')}
          </ListItemText>
        </MenuItem>
        {!nodeContextMenu?.sshEnabled && (
          <Typography variant="caption" sx={{ px: 2, pb: 1, display: 'block', opacity: 0.5 }}>
            <i className="ri-ssh-line" style={{ fontSize: 12, marginRight: 4, verticalAlign: 'middle' }} />
            {t('inventory.maintenanceRequiresSsh')}
          </Typography>
        )}
        <Divider />
        <MenuItem onClick={() => {
          if (nodeContextMenu) {
            const clu = clusters.find(c => c.connId === nodeContextMenu.connId)
            const n = clu?.nodes.find(n => n.node === nodeContextMenu.node)
            openTagDialog('host', '', nodeContextMenu.node, nodeContextMenu.connId, nodeContextMenu.node, { nodeStatus: n?.status, nodeMaintenance: nodeContextMenu.maintenance })
          }
          handleCloseNodeContextMenu()
        }}>
          <ListItemIcon sx={{ minWidth: 36 }}>
            <i className="ri-price-tag-3-line" style={{ fontSize: 18 }} />
          </ListItemIcon>
          <ListItemText>{t('inventory.manageTags', { defaultMessage: 'Manage Tags' })}</ListItemText>
        </MenuItem>
      </Menu>

      {/* Dialog confirmation maintenance */}
      {(() => {
        const entering = maintenanceTarget && !maintenanceTarget.maintenance
        const mConnId = maintenanceTarget?.connId || ''
        const mNode = maintenanceTarget?.node || ''
        const mRunningVms = entering ? getNodeVms(mConnId, mNode).filter(v => v.status === 'running') : []
        const mOtherNodes = entering ? (clusters.find(c => c.connId === mConnId)?.nodes.filter(n => n.node !== mNode) || []) : []
        const mIsCluster = mOtherNodes.length > 0
        const mSharedVms = mIsCluster ? mRunningVms.filter(v => !maintenanceLocalVms.has(`${mConnId}:${v.vmid}`)) : []
        const mLocalVms = mIsCluster ? mRunningVms.filter(v => maintenanceLocalVms.has(`${mConnId}:${v.vmid}`)) : mRunningVms

        return (
        <Dialog
          open={maintenanceTarget !== null}
          onClose={() => { if (!maintenanceBusy) { setMaintenanceTarget(null); setMaintenanceStep(null); setMaintenanceMigrateTarget(''); setMaintenanceShutdownLocal(false) } }}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{
              width: 40, height: 40, borderRadius: 2,
              bgcolor: maintenanceTarget?.maintenance ? 'rgba(76,175,80,0.12)' : 'rgba(255,152,0,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <i
                className={maintenanceTarget?.maintenance ? 'ri-play-circle-line' : 'ri-tools-fill'}
                style={{ fontSize: 22, color: maintenanceTarget?.maintenance ? '#4caf50' : '#ff9800' }}
              />
            </Box>
            {maintenanceTarget?.maintenance ? t('inventory.exitMaintenance') : t('inventory.enterMaintenance')}
          </DialogTitle>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <DialogContentText>
              {maintenanceTarget?.maintenance
                ? t('inventory.confirmExitMaintenance')
                : t('inventory.confirmEnterMaintenance')}
            </DialogContentText>

            {/* VM handling — only when entering maintenance with running VMs */}
            {entering && mRunningVms.length > 0 && mIsCluster && (<>
              {/* Loading storage check */}
              {maintenanceStorageLoading && (
                <Alert severity="info" icon={<CircularProgress size={18} />}>
                  <Typography variant="body2">{t('inventory.nodeActionAnalyzingStorage')}</Typography>
                </Alert>
              )}

              {/* Shared storage VMs */}
              {!maintenanceStorageLoading && mSharedVms.length > 0 && (
                <Alert severity="success" icon={<i className="ri-upload-2-line" style={{ fontSize: 20 }} />}>
                  <Typography variant="body2" fontWeight={600}>
                    {t('inventory.nodeActionSharedVms', { count: mSharedVms.length })}
                  </Typography>
                  <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {mSharedVms.slice(0, 8).map(vm => (
                      <Chip key={`${mConnId}:${vm.vmid}`} size="small" label={`${vm.vmid} ${vm.name}`}
                        icon={<i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: 14 }} />}
                        variant="outlined" color="success" />
                    ))}
                    {mSharedVms.length > 8 && <Chip size="small" label={`+${mSharedVms.length - 8}`} variant="outlined" />}
                  </Box>
                </Alert>
              )}

              {/* Local storage VMs */}
              {!maintenanceStorageLoading && mLocalVms.length > 0 && (
                <Alert severity="warning" icon={<i className="ri-hard-drive-2-line" style={{ fontSize: 20 }} />}>
                  <Typography variant="body2" fontWeight={600}>
                    {t('inventory.nodeActionLocalVms', { count: mLocalVms.length })}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
                    {t('inventory.nodeActionLocalVmsDesc')}
                  </Typography>
                  <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {mLocalVms.slice(0, 8).map(vm => (
                      <Chip key={`${mConnId}:${vm.vmid}`} size="small" label={`${vm.vmid} ${vm.name}`}
                        icon={<i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: 14 }} />}
                        variant="outlined" color="warning" />
                    ))}
                    {mLocalVms.length > 8 && <Chip size="small" label={`+${mLocalVms.length - 8}`} variant="outlined" />}
                  </Box>
                  <Box
                    onClick={() => !maintenanceBusy && setMaintenanceShutdownLocal(!maintenanceShutdownLocal)}
                    sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1, cursor: maintenanceBusy ? 'default' : 'pointer' }}
                  >
                    <Checkbox size="small" checked={maintenanceShutdownLocal} disabled={maintenanceBusy} sx={{ p: 0 }} />
                    <Typography variant="body2">{t('inventory.nodeActionShutdownLocalOption')}</Typography>
                  </Box>
                </Alert>
              )}

              {/* Target node selector */}
              {!maintenanceStorageLoading && mSharedVms.length > 0 && (
                <FormControl fullWidth size="small">
                  <InputLabel>{t('inventory.nodeActionMigrateTarget')}</InputLabel>
                  <Select
                    value={maintenanceMigrateTarget}
                    label={t('inventory.nodeActionMigrateTarget')}
                    onChange={(e) => setMaintenanceMigrateTarget(e.target.value)}
                    disabled={maintenanceBusy}
                  >
                    {mOtherNodes.map(n => (
                      <MenuItem key={n.node} value={n.node}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <NodeIcon status={n.status} size={14} />
                          {n.node}
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </>)}

            {/* Standalone with running VMs */}
            {entering && mRunningVms.length > 0 && !mIsCluster && (
              <Alert severity="info" icon={<i className="ri-information-line" style={{ fontSize: 20 }} />}>
                <Typography variant="body2">
                  {t('inventory.nodeActionRunningVms', { count: mRunningVms.length })}
                </Typography>
              </Alert>
            )}

            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {t('inventory.maintenanceRequiresSsh')}
            </Typography>

            {/* Progress steps */}
            {maintenanceStep && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={18} />
                <Typography variant="body2" sx={{ fontStyle: 'italic' }}>{maintenanceStep}</Typography>
              </Box>
            )}

            {maintenanceError && (
              <Alert severity="error">{maintenanceError}</Alert>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button
              onClick={() => { setMaintenanceTarget(null); setMaintenanceStep(null); setMaintenanceMigrateTarget(''); setMaintenanceShutdownLocal(false) }}
              color="inherit"
              disabled={maintenanceBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleMaintenanceConfirm}
              variant="contained"
              color={maintenanceTarget?.maintenance ? 'success' : 'warning'}
              disabled={(() => {
                if (maintenanceBusy || maintenanceStorageLoading) return true
                if (entering && mRunningVms.length > 0 && mIsCluster) {
                  if (mSharedVms.length > 0 && !maintenanceMigrateTarget) return true
                  if (mLocalVms.length > 0 && !maintenanceShutdownLocal) return true
                }
                return false
              })()}
              startIcon={maintenanceBusy ? <CircularProgress size={16} /> : undefined}
            >
              {t('common.confirm')}
            </Button>
          </DialogActions>
        </Dialog>
        )
      })()}

      {/* Dialog confirmation bulk action */}
      <Dialog
        open={bulkActionDialog.open}
        onClose={() => setBulkActionDialog({ open: false, action: null, connId: '', node: '', targetNode: '' })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 40, height: 40, borderRadius: 2,
            bgcolor: bulkActionDialog.action === 'start-all' ? 'rgba(76,175,80,0.12)' : bulkActionDialog.action === 'migrate-all' ? 'rgba(33,150,243,0.12)' : 'rgba(255,152,0,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            {bulkActionDialog.action === 'start-all' && <PlayArrowIcon fontSize="small" sx={{ color: '#4caf50' }} />}
            {bulkActionDialog.action === 'shutdown-all' && <PowerSettingsNewIcon fontSize="small" sx={{ color: '#ff9800' }} />}
            {bulkActionDialog.action === 'migrate-all' && <MoveUpIcon fontSize="small" sx={{ color: '#2196f3' }} />}
          </Box>
          {bulkActionDialog.action === 'start-all' && t('bulkActions.startAllVms')}
          {bulkActionDialog.action === 'shutdown-all' && t('bulkActions.shutdownAllVms')}
          {bulkActionDialog.action === 'migrate-all' && t('bulkActions.migrateAllVms')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {bulkActionDialog.action === 'start-all' && t('bulkActions.confirmStartAll')}
            {bulkActionDialog.action === 'shutdown-all' && t('bulkActions.confirmShutdownAll')}
            {bulkActionDialog.action === 'migrate-all' && t('bulkActions.confirmMigrateAll')}
          </DialogContentText>
          <Typography variant="body2" fontWeight={600} sx={{ mt: 1.5 }}>
            {t('inventory.node')}: {bulkActionDialog.node}
          </Typography>
          {bulkActionDialog.action === 'start-all' && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.6 }}>
              {getNodeVms(bulkActionDialog.connId, bulkActionDialog.node).filter(v => v.status === 'stopped').length} VMs
            </Typography>
          )}
          {bulkActionDialog.action === 'shutdown-all' && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.6 }}>
              {getNodeVms(bulkActionDialog.connId, bulkActionDialog.node).filter(v => v.status === 'running').length} VMs
            </Typography>
          )}
          {bulkActionDialog.action === 'migrate-all' && (
            <FormControl fullWidth sx={{ mt: 2 }}>
              <InputLabel size="small">{t('bulkActions.targetNode')}</InputLabel>
              <Select
                size="small"
                value={bulkActionDialog.targetNode}
                label={t('bulkActions.targetNode')}
                onChange={(e) => setBulkActionDialog(prev => ({ ...prev, targetNode: e.target.value }))}
              >
                {getOtherNodes(bulkActionDialog.connId, bulkActionDialog.node).map(n => (
                  <MenuItem key={n} value={n}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <NodeIcon status="online" size={14} />
                      {n}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setBulkActionDialog({ open: false, action: null, connId: '', node: '', targetNode: '' })}
            color="inherit"
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleBulkActionConfirm}
            variant="contained"
            color={bulkActionDialog.action === 'start-all' ? 'success' : bulkActionDialog.action === 'migrate-all' ? 'primary' : 'warning'}
            disabled={bulkActionBusy || (bulkActionDialog.action === 'migrate-all' && !bulkActionDialog.targetNode)}
            startIcon={bulkActionBusy ? <CircularProgress size={16} /> : undefined}
          >
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog de clonage */}
      {cloneTarget && (
        <CloneVmDialog
          open={cloneDialogOpen}
          onClose={() => {
            setCloneDialogOpen(false)
            setCloneTarget(null)
          }}
          onClone={handleCloneVm}
          connId={cloneTarget.connId}
          currentNode={cloneTarget.node}
          vmName={cloneTarget.name || `VM ${cloneTarget.vmid}`}
          vmid={cloneTarget.vmid}
          nextVmid={Math.max(100, ...allVms.map(v => Number(v.vmid) || 0)) + 1}
          existingVmids={allVms.map(v => Number(v.vmid) || 0).filter(id => id > 0)}
          pools={[]}
        />
      )}

      {/* Dialog de conversion en template */}
      <Dialog
        open={templateDialogOpen}
        onClose={() => !convertingTemplate && setTemplateDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DescriptionIcon sx={{ fontSize: 24 }} />
          {t('templates.convertToTemplate')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('templates.convertWarning')}
          </Alert>
          {templateTarget && (
            <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>VM:</Typography>
              <Typography variant="subtitle1" fontWeight={700}>
                {templateTarget.name} <Typography component="span" variant="body2" sx={{ opacity: 0.6 }}>(ID: {templateTarget.vmid})</Typography>
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setTemplateDialogOpen(false); setTemplateTarget(null) }} disabled={convertingTemplate}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleConvertToTemplate}
            disabled={convertingTemplate}
            startIcon={convertingTemplate ? <CircularProgress size={16} /> : null}
          >
            {convertingTemplate ? t('common.loading') : t('templates.convert')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog de migration */}
      {migrateTarget && (
        <MigrateVmDialog
          open={migrateDialogOpen}
          onClose={() => {
            setMigrateDialogOpen(false)
            setMigrateTarget(null)
          }}
          connId={migrateTarget.connId}
          currentNode={migrateTarget.node}
          vmName={migrateTarget.name}
          vmid={migrateTarget.vmid}
          vmStatus={migrateTarget.status || 'unknown'}
          vmType={migrateTarget.type as 'qemu' | 'lxc'}
          onMigrate={async (targetNode, online, targetStorage, withLocalDisks) => {
            // Migration intra-cluster
            const { connId, node, type, vmid } = migrateTarget
            const res = await fetch(
              `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/migrate`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target: targetNode, online, targetstorage: targetStorage, 'with-local-disks': withLocalDisks })
              }
            )
            if (!res.ok) {
              const err = await res.json().catch(() => ({}))
              throw new Error(err?.error || res.statusText)
            }
            setMigrateDialogOpen(false)
            setMigrateTarget(null)
            setReloadTick(x => x + 1)
          }}
          onCrossClusterMigrate={async (params: CrossClusterMigrateParams) => {
            // Migration cross-cluster
            const { connId, node, type, vmid } = migrateTarget
            const res = await fetch(
              `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/remote-migrate`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
              }
            )
            if (!res.ok) {
              const err = await res.json().catch(() => ({}))
              throw new Error(err?.error || res.statusText)
            }
            setMigrateDialogOpen(false)
            setMigrateTarget(null)
            setReloadTick(x => x + 1)
          }}
        />
      )}

      {/* Dialog de confirmation action VM */}
      <Dialog
        open={vmActionConfirm !== null}
        onClose={() => setVmActionConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {vmActionConfirm?.action === 'stop' && <StopIcon sx={{ fontSize: 24, color: 'error.main' }} />}
          {vmActionConfirm?.action === 'reset' && <i className="ri-loop-left-line" style={{ fontSize: 24, color: 'var(--mui-palette-error-main)' }} />}
          {vmActionConfirm?.action === 'shutdown' && <PowerSettingsNewIcon sx={{ fontSize: 24, color: 'warning.main' }} />}
          {vmActionConfirm?.action === 'reboot' && <i className="ri-restart-line" style={{ fontSize: 24, color: 'var(--mui-palette-warning-main)' }} />}
          {vmActionConfirm?.action === 'suspend' && <PauseIcon sx={{ fontSize: 24, color: 'info.main' }} />}
          {vmActionConfirm?.action === 'hibernate' && <i className="ri-zzz-line" style={{ fontSize: 24, color: 'var(--mui-palette-info-main)' }} />}
          {t('common.confirm')}
        </DialogTitle>
        <DialogContent>
          <Alert
            severity={['stop', 'reset'].includes(vmActionConfirm?.action || '') ? 'error' : ['shutdown', 'reboot'].includes(vmActionConfirm?.action || '') ? 'warning' : 'info'}
            sx={{ mb: 2 }}
          >
            {vmActionConfirm?.action?.toUpperCase()} — <strong>{vmActionConfirm?.name}</strong>
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setVmActionConfirm(null); handleCloseContextMenu() }}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color={['stop', 'reset'].includes(vmActionConfirm?.action || '') ? 'error' : ['shutdown', 'reboot'].includes(vmActionConfirm?.action || '') ? 'warning' : 'info'}
            onClick={() => vmActionConfirm && executeVmAction(vmActionConfirm.action)}
            disabled={actionBusy}
            startIcon={actionBusy ? <CircularProgress size={16} /> : null}
          >
            {vmActionConfirm?.action?.toUpperCase()}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog d'erreur action VM */}
      <Dialog
        open={vmActionError !== null}
        onClose={() => setVmActionError(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-error-warning-line" style={{ fontSize: 24, color: '#ef4444' }} />
          {t('common.error')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="error">{vmActionError}</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVmActionError(null)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Dialog snapshot */}
      <Dialog
        open={snapshotDialogOpen}
        onClose={() => { setSnapshotDialogOpen(false); setSnapshotTarget(null) }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-camera-line" style={{ fontSize: 24 }} />
          {t('inventory.takeSnapshot')}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField
            label={t('common.name')}
            value={snapshotName}
            onChange={e => setSnapshotName(e.target.value)}
            size="small"
            required
            autoFocus
          />
          <TextField
            label={t('common.description')}
            value={snapshotDesc}
            onChange={e => setSnapshotDesc(e.target.value)}
            size="small"
            multiline
            rows={2}
          />
          {snapshotTarget?.type === 'qemu' && (
          <FormControlLabel
            control={<Switch checked={snapshotVmstate} onChange={e => setSnapshotVmstate(e.target.checked)} size="small" />}
            label={t('inventory.includeRamState')}
          />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setSnapshotDialogOpen(false); setSnapshotTarget(null) }}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={executeSnapshot}
            disabled={creatingSnapshot || !snapshotName.trim()}
            startIcon={creatingSnapshot ? <CircularProgress size={16} /> : null}
          >
            {t('inventory.takeSnapshot')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog backup */}
      <Dialog
        open={backupDialogOpen}
        onClose={() => { setBackupDialogOpen(false); setBackupTarget(null) }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-save-line" style={{ fontSize: 24 }} />
          {t('inventory.backupNow')} — {backupTarget?.name}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <FormControl size="small" fullWidth>
            <InputLabel>{t('inventory.backupStorage')}</InputLabel>
            <Select
              value={backupStorage}
              label={t('inventory.backupStorage')}
              onChange={e => setBackupStorage(e.target.value)}
            >
              {backupStorages.map((s: any) => (
                <MenuItem key={s.storage} value={s.storage}>{s.storage}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>{t('inventory.backupMode')}</InputLabel>
            <Select
              value={backupMode}
              label={t('inventory.backupMode')}
              onChange={e => setBackupMode(e.target.value)}
            >
              <MenuItem value="snapshot">Snapshot</MenuItem>
              <MenuItem value="suspend">Suspend</MenuItem>
              <MenuItem value="stop">Stop</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>{t('inventory.backupCompress')}</InputLabel>
            <Select
              value={backupCompress}
              label={t('inventory.backupCompress')}
              onChange={e => setBackupCompress(e.target.value)}
            >
              <MenuItem value="zstd">ZSTD</MenuItem>
              <MenuItem value="lzo">LZO</MenuItem>
              <MenuItem value="gzip">GZIP</MenuItem>
              <MenuItem value="0">{t('common.none')}</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setBackupDialogOpen(false); setBackupTarget(null) }}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={executeBackupNow}
            disabled={backupLoading || !backupStorage}
            startIcon={backupLoading ? <CircularProgress size={16} /> : null}
          >
            {t('inventory.backupNow')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar(s => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

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

      {/* Node Shell Dialog */}
      <Dialog
        open={shellDialog.open}
        onClose={() => setShellDialog({ open: false, connId: '', node: '', loading: false, data: null, error: null })}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { height: '80vh', bgcolor: 'background.default' } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: 'background.paper', color: 'text.primary', py: 1.5 }}>
          <i className="ri-terminal-box-line" style={{ fontSize: 20 }} />
          <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
            {t('inventory.tabShell')} — {shellDialog.node}
          </Typography>
          <IconButton size="small" onClick={() => setShellDialog({ open: false, connId: '', node: '', loading: false, data: null, error: null })} sx={{ color: 'text.secondary' }}>
            <i className="ri-close-line" style={{ fontSize: 18 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {shellDialog.loading ? (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CircularProgress size={32} sx={{ color: 'text.secondary' }} />
              <Typography sx={{ ml: 2, color: 'text.secondary' }}>{t('inventory.connecting')}...</Typography>
            </Box>
          ) : shellDialog.error ? (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2 }}>
              <i className="ri-error-warning-line" style={{ fontSize: 48, color: 'var(--mui-palette-error-main)' }} />
              <Typography color="error">{shellDialog.error}</Typography>
              <Button variant="outlined" color="error" onClick={() => setShellDialog({ open: false, connId: '', node: '', loading: false, data: null, error: null })}>
                {t('common.close')}
              </Button>
            </Box>
          ) : shellDialog.data ? (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {(() => {
                const XTermShell = require('@/components/xterm/XTermShell').default
                return (
                  <XTermShell
                    wsUrl={shellDialog.data.wsUrl}
                    host={shellDialog.data.host}
                    port={shellDialog.data.port}
                    ticket={shellDialog.data.ticket}
                    node={shellDialog.data.node}
                    user={shellDialog.data.user}
                    pvePort={shellDialog.data.nodePort}
                    apiToken={shellDialog.data.apiToken}
                    onDisconnect={() => setShellDialog(prev => ({ ...prev, data: null, error: 'Disconnected' }))}
                  />
                )
              })()}
            </Box>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Tag management dialog */}
      <Dialog open={tagDialog !== null} onClose={() => setTagDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {tagDialog?.type === 'connection' ? (
              <ClusterIcon nodes={tagDialog?.clusterNodes || []} size={18} />
            ) : (
              <NodeIcon status={tagDialog?.nodeStatus} maintenance={tagDialog?.nodeMaintenance} size={18} />
            )}
            <Typography variant="subtitle1" fontWeight={700}>{tagDialog?.name}</Typography>
            <Typography variant="caption" sx={{ opacity: 0.4, ml: 'auto' }}>
              {tagDialog?.type === 'connection' ? 'Cluster' : 'Node'}
            </Typography>
          </Box>
        </DialogTitle>
        <Divider />
        <DialogContent>
          {tagDialog && (
            <Box sx={{ pt: 1.5 }}>
              <Typography variant="caption" sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', fontSize: 10, display: 'block', mb: 1 }}>
                Tags
              </Typography>
              <EntityTagManager
                tags={tagDialogTags}
                entityType={tagDialog.type}
                entityId={tagDialog.entityId}
                connectionId={tagDialog.connId}
                nodeName={tagDialog.node}
                onTagsChange={setTagDialogTags}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTagDialog(null)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
