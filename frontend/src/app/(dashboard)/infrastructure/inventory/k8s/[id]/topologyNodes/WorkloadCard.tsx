'use client'
import { Handle, Position } from '@xyflow/react'
import { Box, Typography, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'
import { kindColor, healthColor, kindIcon } from '@/lib/k8s/k8sTopologyColors'
import type { DetailRef } from '@/lib/k8s/topologyTypes'

interface WorkloadCardData {
  kind: string
  name: string
  subline?: string
  healthy: boolean
  reason?: string
  detailRef?: DetailRef
  podCount?: number
  healthyCount?: number
  completed?: number
  failed?: number
  active?: number
  incomplete?: boolean
  synthetic?: boolean
  width: number
  height: number
}

export function WorkloadCard({ data, selected }: { data: WorkloadCardData; selected?: boolean }) {
  const t = useTranslations('kubernetes.topology')
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const accent = kindColor(data.kind)
  const hColor = healthColor(data.healthy, data.reason)

  const bgUnhealthy = isDark ? 'rgba(244,67,54,0.08)' : 'rgba(244,67,54,0.05)'
  const borderUnhealthy = isDark ? 'rgba(244,67,54,0.4)' : 'rgba(244,67,54,0.3)'
  const bgNormal = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'
  const borderNormal = selected
    ? theme.palette.primary.main
    : isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'

  const podLine = typeof data.podCount === 'number'
    ? `${data.healthyCount ?? 0}/${data.podCount} ${t('card.ready')}`
    : undefined

  return (
    <Box
      sx={{
        width: data.width,
        height: data.height,
        border: '1.5px solid',
        borderColor: data.healthy ? borderNormal : borderUnhealthy,
        borderRadius: 1.5,
        bgcolor: data.healthy ? bgNormal : bgUnhealthy,
        p: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.4,
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      {/* Kind badge + health dot */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
        <Box
          sx={{
            bgcolor: `${accent}22`,
            color: accent,
            px: 0.75,
            py: 0.1,
            borderRadius: 0.75,
            fontSize: '0.6rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            lineHeight: 1.6,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 0.4,
          }}
        >
          <i className={kindIcon(data.kind)} style={{ fontSize: '0.75rem' }} />
          {data.kind}
        </Box>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: hColor, flexShrink: 0 }} />
      </Box>

      {/* Name */}
      <Typography
        variant="body2"
        sx={{ fontWeight: 600, fontSize: '0.8rem', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {data.name}
      </Typography>

      {/* Subline or pod count */}
      {(data.subline || podLine) && (
        <Typography
          variant="caption"
          sx={{ opacity: 0.6, fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {data.subline ?? podLine}
        </Typography>
      )}

      {/* Reason when unhealthy */}
      {!data.healthy && data.reason && (
        <Typography
          variant="caption"
          sx={{ color: '#f44336', fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {data.reason}
        </Typography>
      )}
    </Box>
  )
}
