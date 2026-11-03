'use client'

import { useCallback, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'

import { Box, Button, Chip, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import BulkPowerDialog, { POWER_ACTION_LOOK, type BulkPowerTarget } from '@/components/BulkPowerDialog'
import HostDrainDialog from '@/components/HostDrainDialog'
import JobDetailDialog from '@/components/tasks/JobDetailDialog'
import type { VmRow } from '@/components/VmsTable'
import { useLicense } from '@/contexts/LicenseContext'
import { useRBAC } from '@/contexts/RBACContext'
import { useTenant } from '@/contexts/TenantContext'
import { BULK_POWER_ACTIONS, powerActionApplies, type BulkPowerAction } from '@/lib/inventory/bulkGuestPower'
import { hostDrainJobRows } from '@/lib/tasks/hostDrainRows'
import { runJobAction } from '@/lib/tasks/jobActions'

// The selection shared by the guest tables (#1218, roadmap#197): guests
// ticked in one or several VmsTable, wherever they run, for a power action or
// the drain planner.
// - Power actions (start, shutdown, reboot, stop) take any guests of the view,
//   over several nodes and clusters, tenant views included: each guest goes
//   through its own route, with the RBAC and vDC checks of a single click.
// - "Migrate selection" hands the guests to the drain planner, which covers
//   one cluster: only for a tenant that owns it (the routes refuse the others),
//   with vm.migrate, on a cluster of two online nodes at least. A user who can
//   migrate but has no power right keeps the one-cluster selection.

export type SelectableVm = Pick<VmRow, 'id' | 'connId' | 'vmid' | 'template'> & Partial<Pick<VmRow, 'node' | 'type' | 'status' | 'name'>>

export type SelectionNode = { connId: string; node: string; status?: string; connName?: string }

/** Which power actions the user may run, from the guest-level permissions. */
export type SelectionPower = { start: boolean; stop: boolean; restart: boolean }

export type GuestSelection = {
  tableProps: {
    selectedIds?: ReadonlySet<string>
    onSelectionChange?: (ids: Set<string>) => void
    isRowSelectable?: (vm: SelectableVm) => boolean
    onSelectionContextMenu?: (event: ReactMouseEvent) => void
  }
  selectedVms: SelectableVm[]
  /** The cluster of the selection when it holds one only. */
  connId: string | undefined
  connName: string | undefined
  /** How many clusters the selection spans. */
  clusterCount?: number
  onlineNodes: string[]
  /** The drain planner is offered (the button shows), and takes this selection (it is enabled). */
  migrateAllowed?: boolean
  canMigrate?: boolean
  power?: SelectionPower
  /** Where a right click on the selection opened its power menu, or null. */
  powerMenuAt?: { top: number; left: number } | null
  closePowerMenu?: () => void
  clear: () => void
}

const NO_POWER: SelectionPower = { start: false, stop: false, restart: false }

function onlineNodesByConn(nodes: SelectionNode[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.status !== 'online') continue
    map.set(n.connId, [...(map.get(n.connId) ?? []), n.node])
  }
  return map
}

/** The drain planner is offered: provider view, vm.migrate, a cluster of two online nodes. */
function useMigrateAllowed(onlineByConn: Map<string, string[]>): boolean {
  const { isFullClusterView } = useTenant()
  const { hasPermission } = useRBAC()

  return isFullClusterView && hasPermission('vm.migrate') && [...onlineByConn.values()].some(n => n.length > 1)
}

/** What the bar shows of a selection: its cluster, and whether the drain planner takes it. */
function selectionScope(selectedVms: SelectableVm[], nodes: SelectionNode[], onlineByConn: Map<string, string[]>, migrateAllowed: boolean) {
  const clusters = [...new Set(selectedVms.map(vm => vm.connId))]
  const connId = clusters.length === 1 ? clusters[0] : undefined
  const onlineNodes = (connId && onlineByConn.get(connId)) || []

  return {
    connId,
    connName: connId ? nodes.find(n => n.connId === connId)?.connName : undefined,
    clusterCount: clusters.length,
    onlineNodes,
    migrateAllowed,
    canMigrate: migrateAllowed && onlineNodes.length > 1,
  }
}

export function useGuestSelection({ vms, nodes, migratingVmIds, resetKey, liveVms }: {
  vms: SelectableVm[]
  nodes: SelectionNode[]
  migratingVmIds?: Set<string>
  resetKey?: string
  /** The live inventory: a table fetched once keeps the power state it had, this one follows it. */
  liveVms?: ReadonlyArray<{ connId: string; vmid: string | number; status?: string }>
}): GuestSelection {
  // The selection belongs to the scope it was made in (cluster, node, view).
  const [picked, setPicked] = useState<{ scope?: string; ids: Set<string> }>(() => ({ scope: resetKey, ids: new Set() }))
  const ids = useMemo(() => (picked.scope === resetKey ? picked.ids : new Set<string>()), [picked, resetKey])
  const setIds = useCallback((next: Set<string>) => setPicked({ scope: resetKey, ids: next }), [resetKey])

  const onlineByConn = useMemo(() => onlineNodesByConn(nodes), [nodes])

  const byId = useMemo(() => new Map(vms.map(vm => [vm.id, vm])), [vms])
  const [powerMenuAt, setPowerMenuAt] = useState<{ top: number; left: number } | null>(null)
  const power = useGuestPowerRights()
  const powerAllowed = hasPowerRight(power)
  const migrateAllowed = useMigrateAllowed(onlineByConn)
  const enabled = powerAllowed || migrateAllowed
  const firstConn = [...ids].map(id => byId.get(id)?.connId).find(Boolean)

  const isRowSelectable = useCallback(
    (vm: SelectableVm) => {
      if (vm.template || migratingVmIds?.has(`${vm.connId}:${vm.vmid}`)) return false
      if (powerAllowed) return true

      return (onlineByConn.get(vm.connId)?.length ?? 0) > 1 && (!firstConn || vm.connId === firstConn)
    },
    [migratingVmIds, onlineByConn, firstConn, powerAllowed],
  )

  // Without power rights a "select all" over several clusters keeps the first.
  const onSelectionChange = useCallback((next: Set<string>) => {
    if (powerAllowed) {
      setIds(next)
      return
    }
    const keep = [...next].map(id => byId.get(id)?.connId).find(Boolean)
    setIds(new Set([...next].filter(id => byId.get(id)?.connId === keep)))
  }, [byId, setIds, powerAllowed])

  const liveStatus = useMemo(() => new Map((liveVms ?? []).map(v => [`${v.connId}:${v.vmid}`, v.status])), [liveVms])

  // Only the guests still listed count: one deleted meanwhile drops out.
  const selectedVms = useMemo(
    () => [...ids]
      .map(id => byId.get(id))
      .filter((vm): vm is SelectableVm => !!vm && isRowSelectable(vm))
      .map(vm => ({ ...vm, status: liveStatus.get(`${vm.connId}:${vm.vmid}`) ?? vm.status })),
    [ids, byId, isRowSelectable, liveStatus],
  )
  // A right click on the selection opens its power menu at the pointer.
  const onSelectionContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault()
    setPowerMenuAt({ top: event.clientY, left: event.clientX })
  }

  let tableProps: GuestSelection['tableProps'] = {}
  if (enabled) tableProps = { selectedIds: ids, onSelectionChange, isRowSelectable, ...(powerAllowed ? { onSelectionContextMenu } : {}) }

  return {
    tableProps,
    selectedVms: enabled ? selectedVms : [],
    ...selectionScope(selectedVms, nodes, onlineByConn, migrateAllowed),
    power: enabled ? power : NO_POWER,
    powerMenuAt,
    closePowerMenu: () => setPowerMenuAt(null),
    clear: () => setIds(new Set()),
  }
}

/**
 * The selection bar of guests picked elsewhere than in a table (Ctrl/Cmd+click
 * in the inventory tree): same power menu, same drain planner.
 */
export function usePickedGuestSelection({ vms, nodes, menuAt, closeMenu, clear }: {
  vms: SelectableVm[]
  nodes: SelectionNode[]
  menuAt: { top: number; left: number } | null
  closeMenu: () => void
  clear: () => void
}): GuestSelection {
  const onlineByConn = useMemo(() => onlineNodesByConn(nodes), [nodes])
  const migrateAllowed = useMigrateAllowed(onlineByConn)
  const power = useGuestPowerRights()

  return {
    tableProps: {},
    selectedVms: vms,
    ...selectionScope(vms, nodes, onlineByConn, migrateAllowed),
    power,
    powerMenuAt: menuAt,
    closePowerMenu: closeMenu,
    clear,
  }
}

// The right each action needs, as the guest route checks it.
const POWER_RIGHT: Record<BulkPowerAction, keyof SelectionPower> = { start: 'start', shutdown: 'stop', reboot: 'restart', stop: 'stop' }

function powerTargets(vms: SelectableVm[], action: BulkPowerAction): BulkPowerTarget[] {
  return vms
    .filter(vm => vm.node && vm.type && powerActionApplies(action, vm.status))
    .map(vm => ({ connId: vm.connId, node: vm.node!, type: vm.type!, vmid: vm.vmid, name: vm.name, status: vm.status }))
}

/** Which power actions the current user may run. */
export function useGuestPowerRights(): SelectionPower {
  const { hasPermission } = useRBAC()

  return useMemo(
    () => ({ start: hasPermission('vm.start'), stop: hasPermission('vm.stop'), restart: hasPermission('vm.restart') }),
    [hasPermission],
  )
}

export function hasPowerRight(power: SelectionPower): boolean {
  return power.start || power.stop || power.restart
}

// The power actions of a set of guests, each with the number of guests it
// applies to; one the user may not run, or that applies to none, is greyed.
// Opened from a button (anchorEl) or a right click (anchorPosition); the
// batch dialog it opens outlives the menu.
export function GuestPowerMenu({ vms, power, anchorEl, anchorPosition, onClose }: {
  vms: SelectableVm[]
  power: SelectionPower
  anchorEl?: HTMLElement | null
  anchorPosition?: { top: number; left: number } | null
  onClose: () => void
}) {
  const t = useTranslations()
  // Frozen when picked: the list must not move while the batch runs.
  const [run, setRun] = useState<{ action: BulkPowerAction; guests: BulkPowerTarget[]; skipped: number } | null>(null)

  const pick = (action: BulkPowerAction) => {
    const guests = powerTargets(vms, action)
    onClose()
    setRun({ action, guests, skipped: vms.length - guests.length })
  }

  return (
    <>
      <Menu
        open={!!anchorEl || !!anchorPosition}
        anchorEl={anchorEl}
        anchorReference={anchorPosition ? 'anchorPosition' : 'anchorEl'}
        anchorPosition={anchorPosition ?? undefined}
        onClose={onClose}
      >
        {BULK_POWER_ACTIONS.map(action => {
          const look = POWER_ACTION_LOOK[action]
          const count = powerTargets(vms, action).length

          return (
            <MenuItem
              key={action}
              dense
              disabled={!power[POWER_RIGHT[action]] || count === 0}
              onClick={() => pick(action)}
              data-testid={`vm-selection-power-${action}`}
            >
              <ListItemIcon sx={{ color: `${look.color}.main`, minWidth: 28 }}><i className={look.icon} style={{ fontSize: 18 }} /></ListItemIcon>
              <ListItemText>{t(`bulkPower.action.${action}`, { count })}</ListItemText>
            </MenuItem>
          )
        })}
      </Menu>
      {run && <BulkPowerDialog {...run} onClose={() => setRun(null)} />}
    </>
  )
}

/** An action of a narrow selection bar: its icon alone, named by its tooltip. */
function BarIcon({ icon, label, help, color = 'primary', disabled = false, onClick, testId }: {
  icon: string
  label: string
  /** The tooltip when it differs from the label (why it is greyed). */
  help?: string
  color?: 'primary' | 'default'
  disabled?: boolean
  onClick: (e: ReactMouseEvent<HTMLElement>) => void
  testId?: string
}) {
  return (
    <Tooltip title={help ?? label}>
      <span>
        <IconButton size="small" color={color} aria-label={label} disabled={disabled} onClick={onClick} data-testid={testId}>
          <i className={icon} style={{ fontSize: 18 }} />
        </IconButton>
      </span>
    </Tooltip>
  )
}

/** The "Power" button of a selection and its menu. */
export function GuestPowerButton({ vms, power, iconOnly = false }: { vms: SelectableVm[]; power: SelectionPower; iconOnly?: boolean }) {
  const t = useTranslations()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  if (!hasPowerRight(power)) return null

  return (
    <>
      {iconOnly ? (
        <BarIcon icon="ri-shut-down-line" label={t('bulkPower.menu')} onClick={e => setAnchor(e.currentTarget)} testId="vm-selection-power" />
      ) : (
        <Button
          size="small"
          variant="outlined"
          startIcon={<i className="ri-shut-down-line" style={{ fontSize: 16 }} />}
          endIcon={<i className="ri-arrow-down-s-line" style={{ fontSize: 16 }} />}
          onClick={e => setAnchor(e.currentTarget)}
          data-testid="vm-selection-power"
          sx={{ textTransform: 'none' }}
        >
          {t('bulkPower.menu')}
        </Button>
      )}
      <GuestPowerMenu vms={vms} power={power} anchorEl={anchor} onClose={() => setAnchor(null)} />
    </>
  )
}

// `inline` puts the count and the buttons in a header row next to its other
// actions; otherwise they make a bar of their own above the tables. `compact`
// fits a narrow pane (the inventory tree): no cluster chip, icons alone.
export function GuestSelectionBar({ selection, sticky = false, inline = false, compact = false }: { selection: GuestSelection; sticky?: boolean; inline?: boolean; compact?: boolean }) {
  const t = useTranslations()
  const { isEnterprise } = useLicense()
  const [dialogOpen, setDialogOpen] = useState(false)
  // The migration just started, followed in the Task Center's own dialog.
  const [started, setStarted] = useState<any>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const { selectedVms, connId, connName, onlineNodes, clear } = selection
  const clusterCount = selection.clusterCount ?? (connId ? 1 : 0)
  // A selection over several clusters, or on a cluster with one online node, cannot be migrated.
  const migrateBlocked = selection.canMigrate === false
  const migrateHelp = clusterCount > 1 ? t('bulkPower.migrateOneCluster') : t('bulkPower.migrateNeedsTwoNodes')

  const content = (
    <>
      <Typography variant="body2" fontWeight={600} noWrap sx={compact ? { flex: 1, minWidth: 0 } : undefined}>{t('hostDrain.selectionCount', { count: selectedVms.length })}</Typography>
      {!compact && connName && <Chip size="small" variant="outlined" label={connName} sx={{ height: 20, fontSize: 11 }} />}
      {!compact && clusterCount > 1 && <Chip size="small" variant="outlined" label={t('bulkPower.clusters', { count: clusterCount })} sx={{ height: 20, fontSize: 11 }} />}
      {!inline && !compact && <Box sx={{ flex: 1 }} />}
      {compact ? (
        <BarIcon icon="ri-close-circle-line" label={t('hostDrain.clearSelection')} color="default" onClick={clear} testId="vm-selection-clear" />
      ) : (
        <Button size="small" color="inherit" onClick={clear} sx={{ textTransform: 'none' }}>{t('hostDrain.clearSelection')}</Button>
      )}
      <GuestPowerButton vms={selectedVms} power={selection.power ?? NO_POWER} iconOnly={compact} />
      {compact && selection.migrateAllowed !== false && (
        <BarIcon
          icon="ri-arrow-left-right-line"
          label={t('hostDrain.migrateSelection')}
          help={migrateBlocked ? migrateHelp : undefined}
          disabled={migrateBlocked}
          onClick={() => setDialogOpen(true)}
          testId="vm-selection-migrate"
        />
      )}
      {!compact && selection.migrateAllowed !== false && (
        <Tooltip title={migrateBlocked ? migrateHelp : ''}>
          <span>
            <Button
              size="small"
              variant="contained"
              startIcon={<i className="ri-arrow-left-right-line" style={{ fontSize: 16 }} />}
              onClick={() => setDialogOpen(true)}
              disabled={migrateBlocked}
              data-testid="vm-selection-migrate"
              sx={{ textTransform: 'none' }}
            >
              {t('hostDrain.migrateSelection')}
            </Button>
          </span>
        </Tooltip>
      )}
    </>
  )

  return (
    <>
      {selectedVms.length > 0 && (inline ? (
        <Stack data-testid="vm-selection-bar" direction="row" spacing={1} alignItems="center">{content}</Stack>
      ) : (
        <Box
          data-testid="vm-selection-bar"
          sx={{
            ...(sticky ? { position: 'sticky', top: 0, zIndex: 3 } : {}),
            px: compact ? 1 : 2, py: compact ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: compact ? 1 : 1.5, borderBottom: '1px solid', borderColor: 'divider',
            bgcolor: 'background.paper', backgroundImage: theme => `linear-gradient(${theme.palette.action.hover}, ${theme.palette.action.hover})`,
          }}
        >
          {content}
        </Box>
      ))}
      <GuestPowerMenu vms={selectedVms} power={selection.power ?? NO_POWER} anchorPosition={selection.powerMenuAt} onClose={() => selection.closePowerMenu?.()} />
      {dialogOpen && connId && (
        <HostDrainDialog
          open
          mode="selection"
          connId={connId}
          node=""
          otherNodes={onlineNodes}
          vmids={selectedVms.map(vm => Number(vm.vmid))}
          onClose={() => setDialogOpen(false)}
          onStarted={drain => {
            clear()
            setActionError(null)
            setStarted(hostDrainJobRows([drain], () => connName ?? '').find(row => row.id === drain?.id) ?? null)
            setTimeout(() => fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {}), 2000)
          }}
        />
      )}
      <JobDetailDialog
        open={!!started}
        job={started}
        onClose={() => setStarted(null)}
        onAction={async (job: any, action: any) => {
          const { ok, error } = await runJobAction(job, action)
          setActionError(ok ? null : (error ?? null))
        }}
        actionError={actionError}
        isEnterprise={isEnterprise}
        t={t}
      />
    </>
  )
}
