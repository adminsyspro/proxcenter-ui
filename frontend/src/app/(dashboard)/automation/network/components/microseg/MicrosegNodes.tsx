'use client'

import { memo } from 'react'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Box, Chip, Tooltip, Typography, alpha, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'

import { getVmStatusColor } from '@/app/(dashboard)/infrastructure/topology/lib/topologyColors'
import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { MS_LANE_HEADER_H, MS_RULE_H, MS_RULE_W, MS_VM_H, MS_VM_W, type MsCardNodeData, type MsFlowNodeData, type MsLaneNodeData, type MsVmNodeData } from './buildFlowGraph'

/**
 * The three custom React Flow cards of the east-west view, styled after the
 * topology page's VmNode so both canvases read as one family. Clicks are
 * handled at the canvas level (onNodeClick), so the cards stay presentational.
 */

const handleStyle = { background: '#999', width: 6, height: 6 }

function MicrosegVmNodeComponent({ data }: NodeProps) {
  const d = data as unknown as MsVmNodeData
  const t = useTranslations('microseg.eastWest')
  const theme = useTheme()
  const statusColor = getVmStatusColor(d.status)

  return (
    <Box
      sx={{
        width: MS_VM_W,
        height: MS_VM_H,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: d.selected ? 'primary.main' : 'divider',
        borderLeftWidth: 3,
        borderLeftColor: d.selected ? 'primary.main' : statusColor,
        borderRadius: 1.5,
        px: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        boxShadow: d.selected ? `0 0 0 2px ${alpha(theme.palette.primary.main, 0.25)}` : '0 1px 4px rgba(0,0,0,0.06)',
        cursor: 'pointer',
        opacity: d.dimmed ? 0.35 : 1,
        '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.12)' },
      }}
    >
      {/* Left column cards emit flows, right column cards receive them. */}
      {d.side === 'source'
        ? <Handle type='source' position={Position.Right} style={handleStyle} />
        : <Handle type='target' position={Position.Left} style={handleStyle} />}

      {/* One text line per card: glyph + pastille, name, then the IP. */}
      <StatusIcon type='vm' status={d.status} vmType={d.vmType} size={14} />
      <Typography variant='caption' fontWeight={600} noWrap sx={{ flex: 1, fontSize: '0.72rem' }}>
        {d.label}
      </Typography>
      <Typography variant='caption' noWrap sx={{ fontSize: '0.62rem', maxWidth: 100, color: d.ip ? 'text.secondary' : 'text.disabled', fontStyle: d.ip ? 'normal' : 'italic' }}>
        {d.ip ?? t('noIp')}
      </Typography>
      {d.openByDefault ? (
        <Tooltip title={d.side === 'source' ? t('openByDefaultOut') : t('openByDefaultIn')}>
          <i className='ri-shield-cross-line' style={{ fontSize: 13, color: '#ff9800', flexShrink: 0 }} />
        </Tooltip>
      ) : (
        d.firewall && <i className='ri-shield-check-line' style={{ fontSize: 13, color: theme.palette.success.main, flexShrink: 0 }} />
      )}
    </Box>
  )
}

export const MicrosegVmNode = memo(MicrosegVmNodeComponent)

function FlowRuleNodeComponent({ data }: NodeProps) {
  const d = data as unknown as MsFlowNodeData
  const t = useTranslations('microseg.eastWest')
  const theme = useTheme()

  // "IN rule #0 on Ubuntu24 · via sg-web": which rule allows the flow and who
  // carries it. The comment only fits in the tooltip.
  const originLabel = (origin: MsFlowNodeData['origins'][number], withComment: boolean): string => {
    const base = t(origin.side === 'in' ? 'originIn' : 'originOut', { pos: origin.pos, name: origin.name })
    const via = origin.via ? ` · ${t('viaSg', { name: origin.via })}` : ''
    const comment = withComment && origin.comment ? ` (${origin.comment})` : ''

    return base + via + comment
  }

  const service = d.macro || [d.proto?.toUpperCase(), d.dport].filter(Boolean).join(' ') || t('anyService')

  return (
    <Tooltip title={d.origins.map(o => originLabel(o, true)).join(' | ')} placement='top'>
      <Box
        sx={{
          width: MS_RULE_W,
          height: MS_RULE_H,
          bgcolor: alpha(theme.palette.success.main, 0.06),
          border: '1px solid',
          borderColor: alpha(theme.palette.success.main, 0.4),
          borderRadius: 1.5,
          px: 1.25,
          py: 0.75,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 0.5,
        }}
      >
        <Handle type='target' position={Position.Left} style={handleStyle} />
        <Handle type='source' position={Position.Right} style={handleStyle} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className='ri-checkbox-circle-fill' style={{ fontSize: 14, color: theme.palette.success.main }} />
          <Chip
            label={service}
            size='small'
            sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: alpha(theme.palette.success.main, 0.15), color: theme.palette.success.main }}
          />
        </Box>
        <Typography variant='caption' color='text.secondary' noWrap sx={{ fontSize: '0.62rem' }}>
          {d.origins[0] ? originLabel(d.origins[0], false) : ''}
          {d.origins.length > 1 ? `  (+${d.origins.length - 1})` : ''}
        </Typography>
      </Box>
    </Tooltip>
  )
}

export const FlowRuleNode = memo(FlowRuleNodeComponent)

function MicrosegCardNodeComponent({ data }: NodeProps) {
  const d = data as unknown as MsCardNodeData
  const t = useTranslations('microseg.eastWest')
  const theme = useTheme()

  const isMiddle = d.variant === 'hint' || d.variant === 'addRule'
  const label = {
    any: d.side === 'source' ? t('anySource') : t('anyDestination'),
    ref: d.ref ?? '',
    hint: t('selectVmHint'),
    addRule: t('addRule'),
  }[d.variant]

  return (
    <Box
      sx={{
        width: isMiddle ? MS_RULE_W : MS_VM_W,
        height: isMiddle ? MS_RULE_H : MS_VM_H,
        border: '1px dashed',
        borderColor: d.variant === 'addRule' ? alpha(theme.palette.primary.main, 0.6) : 'divider',
        borderRadius: 1.5,
        px: 1.25,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.75,
        color: d.variant === 'addRule' ? 'primary.main' : 'text.secondary',
        bgcolor: 'transparent',
        cursor: d.variant === 'addRule' ? 'pointer' : 'default',
        '&:hover': d.variant === 'addRule' ? { bgcolor: alpha(theme.palette.primary.main, 0.06) } : {},
      }}
    >
      {d.side === 'source'
        ? <Handle type='source' position={Position.Right} style={{ ...handleStyle, opacity: isMiddle ? 0 : 1 }} />
        : <Handle type='target' position={Position.Left} style={{ ...handleStyle, opacity: isMiddle ? 0 : 1 }} />}

      <i
        className={{ any: 'ri-global-line', ref: 'ri-question-line', hint: 'ri-cursor-line', addRule: 'ri-add-line' }[d.variant]}
        style={{ fontSize: 14 }}
      />
      <Tooltip title={d.variant === 'ref' ? t('externalRef') : ''} disableHoverListener={d.variant !== 'ref'}>
        <Typography variant='caption' noWrap sx={{ fontSize: '0.7rem', fontWeight: d.variant === 'addRule' ? 700 : 500 }}>
          {label}
        </Typography>
      </Tooltip>
    </Box>
  )
}

export const MicrosegCardNode = memo(MicrosegCardNodeComponent)

function MicrosegLaneNodeComponent({ data }: NodeProps) {
  const d = data as unknown as MsLaneNodeData
  const t = useTranslations('microseg.eastWest')
  const theme = useTheme()
  const color = theme.palette[d.tone].main

  return (
    <Box
      sx={{
        width: d.width,
        height: d.height,
        borderRadius: 2.5,
        border: '1px solid',
        borderColor: alpha(color, 0.25),
        bgcolor: alpha(color, theme.palette.mode === 'dark' ? 0.05 : 0.035),
      }}
    >
      <Box
        sx={{
          height: MS_LANE_HEADER_H,
          px: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          borderBottom: '1px dashed',
          borderColor: alpha(color, 0.3),
          bgcolor: alpha(color, 0.08),
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
        }}
      >
        <i className={d.icon} style={{ fontSize: 15, color }} />
        <Typography variant='caption' sx={{ fontWeight: 700, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color }}>
          {t(d.labelKey)}
        </Typography>
        <Chip label={d.count} size='small' sx={{ ml: 'auto', height: 18, fontSize: 10, fontWeight: 700, bgcolor: alpha(color, 0.15), color }} />
      </Box>
    </Box>
  )
}

export const MicrosegLaneNode = memo(MicrosegLaneNodeComponent)
