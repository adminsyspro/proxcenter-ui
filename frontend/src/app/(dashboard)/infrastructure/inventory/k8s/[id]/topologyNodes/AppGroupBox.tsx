'use client'
import { Handle, Position } from '@xyflow/react'
import { Box, Typography, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'
import { groupColor } from '@/lib/k8s/k8sTopologyColors'

interface AppGroupBoxData {
  label: string
  groupKey: string
  shared?: boolean
  count?: number
  width: number
  height: number
}

export function AppGroupBox({ data }: { data: AppGroupBoxData }) {
  const t = useTranslations('kubernetes.topology')
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const borderColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'
  const gc = data.shared ? theme.palette.warning.main : groupColor(data.groupKey)
  const headerBg = `${gc}26`

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        border: '1.5px solid',
        borderColor: data.shared ? theme.palette.warning.main : borderColor,
        borderStyle: data.shared ? 'dashed' : 'solid',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 0.5,
          bgcolor: headerBg,
          borderBottom: '2px solid',
          borderColor: `${gc}88`,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          height: 40,
        }}
      >
        <i className="ri-apps-line" style={{ fontSize: 14, color: gc, opacity: 0.95 }} />
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.8 }}
          noWrap
        >
          {data.label}
        </Typography>
        {data.shared && (
          <Typography variant="caption" sx={{ opacity: 0.5, fontSize: '0.65rem' }}>
            ({t('group.shared')})
          </Typography>
        )}
        {typeof data.count === 'number' && (
          <Box
            sx={{
              ml: 'auto',
              minWidth: 20,
              px: 0.75,
              py: 0.1,
              borderRadius: 1,
              bgcolor: headerBg,
              border: '1px solid',
              borderColor,
              fontSize: '0.65rem',
              fontWeight: 700,
              opacity: 0.7,
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            {data.count}
          </Box>
        )}
      </Box>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </Box>
  )
}
