'use client'
import { useMemo, useState } from 'react'
import {
  Box,
  CircularProgress,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import type { ColumnDef, KindDef } from '@/lib/k8s/resourceKinds'
import { KindIcon } from './KindIcon'
import type { ResourceListItem } from '@/lib/k8s/types'
import { cellValue, formatGiB, sortItems } from '@/lib/k8s/tableColumns'
import { relativeAge } from '@/lib/k8s/overviewCharts'
import { utilizationColor } from '@/lib/k8s/metrics'
import { NODE_OP_ICONS, type DrainRowState } from '@/lib/k8s/nodeOpsClient'
import { podListPreview } from '@/lib/k8s/nodeDrain'
import { useTooltipSlotProps } from '@/lib/ui/tooltipSlotProps'
import { actionsFor, WORKLOAD_ACTION_ICONS, type WorkloadAction } from '@/lib/k8s/workloadActions'

/** Renders a 0-100 percentage summary value as a compact usage bar. */
function ProgressCell({ value }: { value: string }) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return <Box component="span" sx={{ opacity: 0.4 }}>n/a</Box>
  const color = utilizationColor(n)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
      <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box sx={{ width: `${Math.max(0, Math.min(100, n))}%`, height: '100%', bgcolor: color }} />
      </Box>
      <Box sx={{ fontSize: '0.72rem', opacity: 0.8, width: 32, textAlign: 'right', flexShrink: 0 }}>{n}%</Box>
    </Box>
  )
}

interface ResourceTableProps {
  kind: KindDef
  items: ResourceListItem[]
  onRowClick: (item: ResourceListItem) => void
  /** hasPermission('k8s.manage'); gates the node action column (routes re-check). */
  canManage?: boolean
  /** Per-node background drain state, keyed by node name (row spinner/indicators). */
  drainStates?: Record<string, DrainRowState>
  /** Cordon/uncordon a node (confirmed by the container). */
  onCordonToggle?: (item: ResourceListItem) => void
  /** Open the drain confirm dialog for this node. */
  onDrain?: (item: ResourceListItem) => void
  /** Workers that can be removed from the cluster (deployed by ProxCenter). */
  removableNodes?: Set<string>
  /** Open the removal dialog of a worker. */
  onRemoveNode?: (item: ResourceListItem) => void
  /** Open the dialog of a workload action (restart, scale, rollback, pod delete). */
  onWorkloadAction?: (action: WorkloadAction, item: ResourceListItem) => void
}

/** Per-row action buttons of a workload or pod. */
function WorkloadActionsCell({ item, actions, onAction }: {
  item: ResourceListItem
  actions: WorkloadAction[]
  onAction: (action: WorkloadAction, item: ResourceListItem) => void
}) {
  const t = useTranslations('kubernetes.workload.action')
  const slotProps = useTooltipSlotProps()
  return (
    <Box sx={{ display: 'flex', gap: 0.25, justifyContent: 'flex-end' }}>
      {actions.map(action => (
        <Tooltip key={action} title={t(action)} arrow slotProps={slotProps}>
          <IconButton
            size="small"
            color={action === 'delete' ? 'error' : 'default'}
            aria-label={t(action)}
            onClick={(e) => { e.stopPropagation(); onAction(action, item) }}
          >
            <i className={WORKLOAD_ACTION_ICONS[action]} style={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      ))}
    </Box>
  )
}

/** Cordon / drained / drain-progress indicators shown next to a node's name. */
function NodeStatusIcons({ item, drainState }: { item: ResourceListItem; drainState?: DrainRowState }) {
  const t = useTranslations('kubernetes.node.ops')
  const slotProps = useTooltipSlotProps()
  const cordoned = item.summary?.['unschedulable'] === 'true'
  // A finished drain (this session) is the reliable signal; pods===0 is only a
  // fallback for nodes drained outside this session (DaemonSet/mirror pods keep
  // the total count above 0 on most real nodes, so it rarely triggers).
  const drained = drainState?.phase === 'done' || (cordoned && item.summary?.['pods'] === '0')

  if (drainState?.phase === 'draining') {
    return (
      <Tooltip title={t('draining', { count: drainState.result?.remaining.length ?? 0 })} arrow slotProps={slotProps}>
        <CircularProgress size={14} color="warning" sx={{ ml: 0.25 }} />
      </Tooltip>
    )
  }

  const r = drainState?.result
  const stopped = drainState?.phase === 'stopped' || drainState?.phase === 'error'
  const failureReason = r?.evictionFailureReason ? ` (${r.evictionFailureReason})` : ''
  const stoppedReason = drainState?.phase === 'error'
    ? (drainState.error ?? '')
    : [
        r?.blockedByPdb.length ? t('blockedByPdb', { pods: podListPreview(r.blockedByPdb) }) : '',
        r?.evictionFailures.length ? `${t('evictionFailed', { pods: podListPreview(r.evictionFailures) })}${failureReason}` : '',
        r && [...r.refusedEmptyDir, ...r.refusedUnmanaged].length ? t('refusedHint') : '',
        r?.remaining.length ? t('draining', { count: r.remaining.length }) : '',
      ].filter(Boolean).join(' · ')

  return (
    <>
      {cordoned && (
        <Tooltip title={t('scheduling.disabled')} arrow slotProps={slotProps}>
          <Box component="i" className={NODE_OP_ICONS.cordon} sx={{ fontSize: 14, color: 'warning.main' }} />
        </Tooltip>
      )}
      {drained && (
        <Tooltip title={t('drained')} arrow slotProps={slotProps}>
          <Box component="i" className={NODE_OP_ICONS.drain} sx={{ fontSize: 14, color: 'success.main' }} />
        </Tooltip>
      )}
      {stopped && (
        <Tooltip title={stoppedReason} arrow slotProps={slotProps}>
          <Box
            component="i"
            className="ri-error-warning-line"
            sx={{ fontSize: 14, color: drainState?.phase === 'error' ? 'error.main' : 'warning.main' }}
          />
        </Tooltip>
      )}
    </>
  )
}

/** Per-row cordon/drain/maintenance icon buttons for the Nodes table. */
function NodeActionsCell({
  item, drainState, onCordonToggle, onDrain, onRemove,
}: {
  item: ResourceListItem
  drainState?: DrainRowState
  onCordonToggle: (item: ResourceListItem) => void
  onDrain: (item: ResourceListItem) => void
  /** Set for a worker that can be removed from the cluster. */
  onRemove?: (item: ResourceListItem) => void
}) {
  const tWorkers = useTranslations('kubernetes.workers')
  const t = useTranslations('kubernetes.node.ops')
  const slotProps = useTooltipSlotProps()
  const cordoned = item.summary?.['unschedulable'] === 'true'
  // Disable drain while one is already running for this node.
  const draining = drainState?.phase === 'draining'
  return (
    <Box sx={{ display: 'flex', gap: 0.25, justifyContent: 'flex-end' }}>
      <Tooltip title={cordoned ? t('uncordon') : t('cordon')} arrow slotProps={slotProps}>
        <IconButton
          size="small"
          aria-label={cordoned ? t('uncordon') : t('cordon')}
          onClick={(e) => { e.stopPropagation(); onCordonToggle(item) }}
        >
          <i className={cordoned ? NODE_OP_ICONS.uncordon : NODE_OP_ICONS.cordon} style={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
        <Tooltip title={t('drain')} arrow slotProps={slotProps}>
          <span>
            <IconButton
              size="small"
              color="warning"
              disabled={draining}
              aria-label={t('drain')}
              onClick={(e) => { e.stopPropagation(); onDrain(item) }}
            >
              <i className={NODE_OP_ICONS.drain} style={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
        {onRemove && (
          <Tooltip title={tWorkers('removeAction')} arrow slotProps={slotProps}>
            <span>
              <IconButton
                size="small"
                color="error"
                disabled={draining}
                aria-label={tWorkers('removeAction')}
                onClick={(e) => { e.stopPropagation(); onRemove(item) }}
              >
                <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
    </Box>
  )
}

export function ResourceTable({ kind, items, onRowClick, canManage, drainStates, onCordonToggle, onDrain, removableNodes, onRemoveNode, onWorkloadAction }: ResourceTableProps) {
  const t = useTranslations('kubernetes.explorer')
  const [sortCol, setSortCol] = useState<ColumnDef>(
    () => kind.columns.find(c => c.key === kind.defaultSort?.key) ?? kind.columns[0],
  )
  const [dir, setDir] = useState<'asc' | 'desc'>(kind.defaultSort?.dir ?? 'asc')
  const [q, setQ] = useState('')

  // Node day-2 action column: only for nodes, only with k8s.manage, and only
  // when the container wired the handlers.
  const showNodeActions = kind.apiKind === 'node' && !!canManage && !!onCordonToggle && !!onDrain
  const workloadActions = canManage && onWorkloadAction ? actionsFor(kind.apiKind) : []
  const showActions = showNodeActions || workloadActions.length > 0

  const rows = useMemo(() => {
    const filtered = q
      ? items.filter(i => i.name.toLowerCase().includes(q.toLowerCase()))
      : items
    return sortItems(filtered, sortCol, dir)
  }, [items, q, sortCol, dir])

  const onSort = (col: ColumnDef) => {
    if (col.key === sortCol.key) {
      setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setDir('asc')
    }
  }

  const renderCell = (item: ResourceListItem, col: ColumnDef, ci: number) => {
    if (ci === 0) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <KindIcon icon={kind.icon} iconImg={kind.iconImg} size={16} sx={{ color: 'text.secondary' }} />
          <span>{cellValue(item, col)}</span>
          {kind.apiKind === 'node' && (
            <NodeStatusIcons item={item} drainState={drainStates?.[item.name]} />
          )}
        </Box>
      )
    }
    if (col.type === 'progress') return <ProgressCell value={cellValue(item, col)} />
    if (col.type === 'bytes') return formatGiB(cellValue(item, col))
    if (col.type === 'age') return <span title={cellValue(item, col)}>{relativeAge(cellValue(item, col))}</span>

    return cellValue(item, col)
  }

  return (
    <Box>
      <TextField
        size="small"
        placeholder={t('search')}
        value={q}
        onChange={e => setQ(e.target.value)}
        sx={{ mb: 1 }}
      />
      {/* One line per row: a long name scrolls the table sideways instead of
          wrapping on four lines. Only the event message may wrap. */}
      <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {kind.columns.map(col => (
              <TableCell key={col.key} sx={{ whiteSpace: 'nowrap' }}>
                <TableSortLabel
                  active={sortCol.key === col.key}
                  direction={sortCol.key === col.key ? dir : 'asc'}
                  onClick={() => onSort(col)}
                >
                  {t(`col.${col.header}`)}
                </TableSortLabel>
              </TableCell>
            ))}
            {showActions && (
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{t('col.actions')}</TableCell>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(item => (
            <TableRow
              key={item.uid}
              hover
              sx={{ cursor: 'pointer' }}
              onClick={() => onRowClick(item)}
            >
              {kind.columns.map((col, ci) => (
                <TableCell key={col.key} sx={col.key === 'message' ? { minWidth: 320 } : { whiteSpace: 'nowrap' }}>
                  {renderCell(item, col, ci)}
                </TableCell>
              ))}
              {showActions && (
                <TableCell align="right" sx={{ py: 0 }}>
                  {showNodeActions
                    ? <NodeActionsCell item={item} drainState={drainStates?.[item.name]} onCordonToggle={onCordonToggle!} onDrain={onDrain!} onRemove={removableNodes?.has(item.name) ? onRemoveNode : undefined} />
                    : <WorkloadActionsCell item={item} actions={workloadActions} onAction={onWorkloadAction!} />}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </Box>
    </Box>
  )
}
