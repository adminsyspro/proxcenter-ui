'use client'
import { Handle, Position } from '@xyflow/react'
import { Box, Typography, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'
import type { DetailRef } from '@/lib/k8s/topologyTypes'
import type { K8sUnmatchedReason, K8sMatchKey } from '@/lib/k8s/topologyTypes'

interface K8sNodeCardData {
  name: string
  ready: boolean
  version: string
  internalIP?: string
  detailRef: DetailRef
  match?: {
    key: K8sMatchKey
    vmid?: number
    vmName?: string
    confidence: 'high' | 'medium' | 'low'
  }
  unmatchedReason?: K8sUnmatchedReason
  uid: string
  hostId: string
  hostName?: string
  clusterName?: string
  width: number
  height: number
}

export function K8sNodeCard({ data, selected }: { data: K8sNodeCardData; selected?: boolean }) {
  const t = useTranslations('kubernetes.topology')
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const readyColor = data.ready ? '#4caf50' : '#f44336'
  const borderNormal = selected
    ? theme.palette.primary.main
    : isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'

  return (
    <Box
      sx={{
        width: data.width,
        height: data.height,
        border: '1.5px solid',
        borderColor: borderNormal,
        borderRadius: 1.5,
        bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
        p: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.35,
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      {/* Kind badge + ready dot */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
        <Box
          sx={{
            bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
            px: 0.75,
            py: 0.1,
            borderRadius: 0.75,
            fontSize: '0.6rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.3,
            lineHeight: 1.6,
            flexShrink: 0,
          }}
        >
          {t('node.badge')}
        </Box>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: readyColor, flexShrink: 0 }} />
      </Box>

      {/* Name */}
      <Typography
        variant="body2"
        sx={{ fontWeight: 600, fontSize: '0.8rem', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {data.name}
      </Typography>

      {/* Version + IP */}
      <Typography
        variant="caption"
        sx={{ opacity: 0.55, fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {[data.version, data.internalIP].filter(Boolean).join(' · ')}
      </Typography>

      {/* VM match or unmapped */}
      {data.match ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
          <Typography
            variant="caption"
            sx={{ opacity: 0.7, fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {t('node.vm')} {data.match.vmName ?? `#${data.match.vmid ?? ''}`}
            {data.hostName ? ` @ ${data.hostName}` : ''}
            {data.hostName && data.clusterName ? ` (${data.clusterName})` : ''}
          </Typography>
          {data.match.confidence === 'low' && (
            <Typography variant="caption" sx={{ opacity: 0.45, fontSize: '0.62rem', flexShrink: 0 }}>
              ({t('node.unverified')})
            </Typography>
          )}
        </Box>
      ) : (
        <Typography variant="caption" sx={{ opacity: 0.4, fontSize: '0.68rem' }}>
          {t('node.unmapped')}
        </Typography>
      )}
    </Box>
  )
}
