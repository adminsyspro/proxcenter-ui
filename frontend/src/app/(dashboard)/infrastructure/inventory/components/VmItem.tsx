'use client'

import React from 'react'
import type { useTranslations } from 'next-intl'

import {
  Box,
  Chip,
  IconButton,
  LinearProgress,
  Tooltip,
  Typography,
} from '@mui/material'

import { useTagColors } from '@/contexts/TagColorContext'
import { StatusIcon } from './TreeIcons'

// Re-export getVmIcon for consumers that import from VmItem
export { getVmIcon } from './TreeIcons'

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

// Composant Tag réutilisable - uses tagColorFallback for tree sidebar
export function TagChip({ tag, connId }: { tag: string; connId?: string }) {
  const { getColor } = useTagColors(connId)
  const c = getColor(tag).bg

  return (
    <Chip
      label={tag}
      size="small"
      sx={{
        height: 16,
        fontSize: 9,
        bgcolor: `${c}18`,
        color: c,
        fontWeight: 600,
        '& .MuiChip-label': { px: 0.75 }
      }}
    />
  )
}

// Seuils d'alerte (en pourcentage)
const CPU_WARNING_THRESHOLD = 95
const RAM_WARNING_THRESHOLD = 95

// Calcule le pourcentage de RAM utilisée
function getMemPct(mem?: number, maxmem?: number): number {
  if (!mem || !maxmem || maxmem === 0) return 0

return (mem / maxmem) * 100
}

// Calcule le pourcentage CPU (déjà en fraction 0-1 depuis l'API)
function getCpuPct(cpu?: number): number {
  if (!cpu) return 0

return cpu * 100
}

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type VmItemVariant = 'flat' | 'favorite' | 'grouped' | 'template' | 'tree'

export type VmItemProps = {
  vmKey: string
  connId: string
  connName: string
  node: string
  vmType: string
  vmid: string
  name: string
  status?: string
  cpu?: number
  mem?: number
  maxmem?: number
  template?: boolean
  isCluster?: boolean
  isSelected: boolean
  isMigrating: boolean
  isPendingAction: boolean
  isFavorite: boolean
  onFavoriteToggle: (e: React.MouseEvent) => void
  onClick: () => void
  onDoubleClick?: () => void
  onContextMenu: (e: React.MouseEvent) => void
  variant: VmItemVariant
  t: ReturnType<typeof useTranslations>
  tags?: string[]
  showVmId?: boolean
  lock?: string
}

/* ------------------------------------------------------------------ */
/* VmItem Component                                                   */
/* ------------------------------------------------------------------ */

export const VmItem = React.memo(function VmItem(props: VmItemProps) {
  const {
    vmKey,
    connId,
    connName,
    node,
    vmType,
    vmid,
    name,
    status,
    cpu,
    mem,
    maxmem,
    template,
    isSelected,
    isMigrating,
    isPendingAction,
    isFavorite,
    onFavoriteToggle,
    onClick,
    onDoubleClick,
    onContextMenu,
    variant,
    t,
    tags,
    showVmId,
    lock,
  } = props
  const { getColor, getShape } = useTagColors(connId)
  const shape = getShape(connId)

  // Render tags according to PVE shape setting
  const validTags = tags?.filter(t => t && t.trim()) || []
  const tagElements = (validTags.length > 0 && shape !== 'none') ? validTags.map(tag => {
    const { bg, fg } = getColor(tag)
    if (shape === 'circle') {
      return (
        <Tooltip key={tag} title={tag}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: bg, flexShrink: 0 }} />
        </Tooltip>
      )
    }
    if (shape === 'dense') {
      return (
        <Tooltip key={tag} title={tag}>
          <Box sx={{ width: 12, height: 8, borderRadius: 0, bgcolor: bg, flexShrink: 0 }} />
        </Tooltip>
      )
    }
    // shape === 'full'
    return (
      <Chip
        key={tag}
        label={tag}
        size="small"
        sx={{
          height: 16,
          fontSize: 9,
          borderRadius: 0.5,
          bgcolor: bg,
          color: fg,
          fontWeight: 600,
          flexShrink: 0,
          '& .MuiChip-label': { px: 0.5 }
        }}
      />
    )
  }) : null

  if (variant === 'tree') {
    const cpuPct = getCpuPct(cpu)
    const memPct = getMemPct(mem, maxmem)
    const statusColor = status === 'running' ? '#4caf50' : status === 'paused' ? '#ff9800' : '#9e9e9e'
    const headerColor = status === 'running' ? '#3b82f6' : status === 'paused' ? '#f59e0b' : '#6b7280'

    const tooltipContent = (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75, bgcolor: headerColor }}>
          <i className={vmType === 'lxc' ? 'ri-instance-fill' : 'ri-computer-fill'} style={{ fontSize: 14, color: '#fff' }} />
          <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 12, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {vmType === 'lxc' ? 'CT' : 'VM'} {vmid} - {name}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, px: 1.5, py: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: statusColor, flexShrink: 0, ml: '4px' }} />
            <Typography variant="caption" sx={{ textTransform: 'capitalize', fontSize: 11 }}>{status || 'unknown'}</Typography>
          </Box>
          {status === 'running' && cpu != null && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-cpu-line" style={{ fontSize: 12, opacity: 0.6, width: 14, flexShrink: 0 }} />
              <Typography variant="caption" sx={{ minWidth: 24, fontSize: 11 }}>CPU</Typography>
              <LinearProgress
                variant="determinate"
                value={Math.min(cpuPct, 100)}
                sx={{
                  flex: 1, height: 4, borderRadius: 2,
                  bgcolor: 'action.hover',
                  '& .MuiLinearProgress-bar': { borderRadius: 2, bgcolor: cpuPct >= 90 ? 'error.main' : cpuPct >= 60 ? 'warning.main' : 'primary.main' }
                }}
              />
              <Typography variant="caption" sx={{ minWidth: 28, textAlign: 'right', fontSize: 11 }}>{cpuPct.toFixed(0)}%</Typography>
            </Box>
          )}
          {status === 'running' && maxmem ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <i className="ri-ram-line" style={{ fontSize: 12, opacity: 0.6, width: 14, flexShrink: 0 }} />
                <Typography variant="caption" sx={{ minWidth: 24, fontSize: 11 }}>RAM</Typography>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(memPct, 100)}
                  sx={{
                    flex: 1, height: 4, borderRadius: 2,
                    bgcolor: 'action.hover',
                    '& .MuiLinearProgress-bar': { borderRadius: 2, bgcolor: memPct >= 90 ? 'error.main' : memPct >= 60 ? 'warning.main' : 'primary.main' }
                  }}
                />
                <Typography variant="caption" sx={{ minWidth: 28, textAlign: 'right', fontSize: 11 }}>{memPct.toFixed(0)}%</Typography>
              </Box>
            </>
          ) : null}
        </Box>
      </Box>
    )

    return (
      <Tooltip
        title={tooltipContent}
        enterDelay={1000}
        enterNextDelay={1000}
        placement="right"
        slotProps={{
          tooltip: {
            sx: {
              bgcolor: 'background.paper',
              color: 'text.primary',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1.5,
              boxShadow: 3,
              p: 0,
              width: 240,
              overflow: 'hidden',
            }
          }
        }}
      >
      <Box
        onDoubleClick={(e: React.MouseEvent) => {
          e.stopPropagation()
          if (!isMigrating && !template && onDoubleClick) onDoubleClick()
        }}
        sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}
      >
        <Box
          component="span"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation()
            if (!isMigrating) onFavoriteToggle(e)
          }}
          sx={{
            cursor: isMigrating ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            color: isFavorite ? '#ffc107' : 'text.disabled',
            '&:hover': { color: isMigrating ? undefined : '#ffc107' },
          }}
        >
          <i className={isFavorite ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
        </Box>
        <StatusIcon status={status} type="vm" isMigrating={isMigrating} isPendingAction={isPendingAction} template={template} vmType={vmType} lock={lock} />
        <Typography variant="body2" sx={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {showVmId ? `${vmid} - ${name}` : name}
        </Typography>
        {template && (
          <Chip label={t('inventory.tpl')} size="small" sx={{ height: 16, fontSize: 10 }} />
        )}
        {status === 'running' && getCpuPct(cpu) >= CPU_WARNING_THRESHOLD && (
          <Tooltip title={`${t('common.warning')} CPU: ${getCpuPct(cpu).toFixed(0)}%`}>
            <i className="ri-cpu-line" style={{ fontSize: 14, color: '#ed6c02' }} />
          </Tooltip>
        )}
        {status === 'running' && getMemPct(mem, maxmem) >= RAM_WARNING_THRESHOLD && (
          <Tooltip title={`${t('common.warning')} RAM: ${getMemPct(mem, maxmem).toFixed(0)}%`}>
            <i className="ri-ram-line" style={{ fontSize: 14, color: '#ed6c02' }} />
          </Tooltip>
        )}
        {tagElements}
      </Box>
      </Tooltip>
    )
  }

  if (variant === 'template') {
    const vmContent = (
      <Box
        data-vmkey={vmKey}
        onClick={() => !isMigrating && onClick()}
        onContextMenu={(e) => { if (!isMigrating) onContextMenu(e) }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.4,
          cursor: isMigrating ? 'not-allowed' : 'pointer',
          borderRadius: 1,
          bgcolor: isSelected
            ? 'action.selected'
            : 'transparent',
          opacity: isMigrating ? 0.5 : 1,
          '&:hover': { bgcolor: isMigrating ? 'transparent' : 'action.hover' },
          '&:hover .favorite-star': { opacity: isMigrating ? 0 : 1 }
        }}
      >
        <IconButton
          size="small"
          className="favorite-star"
          onClick={(e) => {
            e.stopPropagation()
            onFavoriteToggle(e)
          }}
          sx={{
            p: 0.25,
            opacity: isFavorite ? 1 : 0,
            transition: 'opacity 0.2s',
            color: isFavorite ? '#ffc107' : 'text.secondary',
            '&:hover': { color: '#ffc107' }
          }}
        >
          <i className={isFavorite ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
        </IconButton>
        <i className="ri-file-copy-fill" style={{ opacity: 0.8, fontSize: 14, color: '#0288d1' }} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {showVmId ? `${vmid} - ${name}` : name}
          </Typography>
          <Chip label={vmType === 'lxc' ? 'LXC' : 'VM'} size="small" sx={{ height: 16, fontSize: 10 }} />
        </Box>
      </Box>
    )
    return isMigrating ? <Tooltip title={t('audit.actions.migrate') + "..."} placement="right">{vmContent}</Tooltip> : vmContent
  }

  if (variant === 'favorite') {
    const vmContent = (
      <Box
        data-vmkey={vmKey}
        onClick={() => !isMigrating && onClick()}
        onContextMenu={(e) => { if (!isMigrating) onContextMenu(e) }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.4,
          cursor: isMigrating ? 'not-allowed' : 'pointer',
          borderRadius: 1,
          bgcolor: isSelected
            ? 'action.selected'
            : 'transparent',
          opacity: isMigrating ? 0.5 : 1,
          '&:hover': { bgcolor: isMigrating ? 'transparent' : 'action.hover' }
        }}
      >
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            onFavoriteToggle(e)
          }}
          sx={{
            p: 0.25,
            color: '#ffc107',
            '&:hover': { color: '#ff9800' }
          }}
        >
          <i className="ri-star-fill" style={{ fontSize: 14 }} />
        </IconButton>
        <StatusIcon status={status} type="vm" isMigrating={isMigrating} isPendingAction={isPendingAction} template={template} vmType={vmType} lock={lock} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {showVmId ? `${vmid} - ${name}` : name}
          </Typography>
          {template && (
            <Chip label={t('inventory.template')} size="small" sx={{ height: 16, fontSize: 10, ml: 0.5 }} />
          )}
        </Box>
      </Box>
    )
    return isMigrating ? <Tooltip title={t('audit.actions.migrate') + "..."} placement="right">{vmContent}</Tooltip> : vmContent
  }

  const isGrouped = variant === 'grouped'

  const vmContent = (
    <Box
      data-vmkey={vmKey}
      onClick={() => !isMigrating && onClick()}
      onDoubleClick={() => { if (!isMigrating && !template && onDoubleClick) onDoubleClick() }}
      onContextMenu={(e) => { if (!isMigrating) onContextMenu(e) }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        ...(isGrouped ? { pl: 3, py: 0.25 } : { py: 0.4 }),
        cursor: isMigrating ? 'not-allowed' : 'pointer',
        ...(!isGrouped ? { borderRadius: 1 } : {}),
        bgcolor: isSelected
          ? (isGrouped ? undefined : 'action.selected')
          : 'transparent',
        opacity: isMigrating ? 0.5 : 1,
        '&:hover': { bgcolor: isMigrating ? 'transparent' : 'action.hover' },
        '&:hover .favorite-star': { opacity: isMigrating ? 0 : 1 }
      }}
    >
      <IconButton
        size="small"
        className="favorite-star"
        onClick={(e) => {
          e.stopPropagation()
          onFavoriteToggle(e)
        }}
        sx={{
          p: 0.25,
          opacity: isFavorite ? 1 : 0,
          transition: 'opacity 0.2s',
          color: isFavorite ? '#ffc107' : 'text.secondary',
          '&:hover': { color: '#ffc107' }
        }}
      >
        <i className={isFavorite ? "ri-star-fill" : "ri-star-line"} style={{ fontSize: 14 }} />
      </IconButton>
      <StatusIcon status={status} type="vm" isMigrating={isMigrating} isPendingAction={isPendingAction} template={template} vmType={vmType} lock={lock} />
      {isGrouped ? (
        <>
          <Typography variant="body2" sx={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {showVmId ? `${vmid} - ${name}` : name}
          </Typography>
          {template && (
            <Chip label={t('inventory.tpl')} size="small" sx={{ height: 16, fontSize: 10 }} />
          )}
          {status === 'running' && getCpuPct(cpu) >= CPU_WARNING_THRESHOLD && (
            <Tooltip title={`${t('common.warning')} CPU: ${getCpuPct(cpu).toFixed(0)}%`}>
              <i className="ri-cpu-line" style={{ fontSize: 14, color: '#ed6c02' }} />
            </Tooltip>
          )}
          {status === 'running' && getMemPct(mem, maxmem) >= RAM_WARNING_THRESHOLD && (
            <Tooltip title={`${t('common.warning')} RAM: ${getMemPct(mem, maxmem).toFixed(0)}%`}>
              <i className="ri-ram-line" style={{ fontSize: 14, color: '#ed6c02' }} />
            </Tooltip>
          )}
          {tagElements}
        </>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {showVmId ? `${vmid} - ${name}` : name}
          </Typography>
          {template && (
            <Chip label={t('inventory.template')} size="small" sx={{ height: 16, fontSize: 10, ml: 0.5 }} />
          )}
          {status === 'running' && getCpuPct(cpu) >= CPU_WARNING_THRESHOLD && (
            <Tooltip title={`${t('common.warning')} CPU: ${getCpuPct(cpu).toFixed(0)}%`}>
              <i className="ri-cpu-line" style={{ fontSize: 14, color: '#ed6c02', flexShrink: 0 }} />
            </Tooltip>
          )}
          {status === 'running' && getMemPct(mem, maxmem) >= RAM_WARNING_THRESHOLD && (
            <Tooltip title={`${t('common.warning')} RAM: ${getMemPct(mem, maxmem).toFixed(0)}%`}>
              <i className="ri-ram-line" style={{ fontSize: 14, color: '#ed6c02', flexShrink: 0 }} />
            </Tooltip>
          )}
          {tagElements}
        </Box>
      )}
    </Box>
  )
  return isMigrating ? <Tooltip title={t('audit.actions.migrate') + "..."} placement="right">{vmContent}</Tooltip> : vmContent
}, (prev, next) =>
  prev.vmKey === next.vmKey &&
  prev.isSelected === next.isSelected &&
  prev.isMigrating === next.isMigrating &&
  prev.isPendingAction === next.isPendingAction &&
  prev.isFavorite === next.isFavorite &&
  prev.status === next.status &&
  prev.cpu === next.cpu &&
  prev.mem === next.mem &&
  prev.maxmem === next.maxmem &&
  prev.name === next.name &&
  prev.variant === next.variant &&
  prev.template === next.template &&
  prev.tags?.join(';') === next.tags?.join(';') &&
  prev.showVmId === next.showVmId &&
  prev.lock === next.lock
)
