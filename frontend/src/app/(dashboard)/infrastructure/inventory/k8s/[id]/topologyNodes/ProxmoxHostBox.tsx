'use client'
import { Handle, Position } from '@xyflow/react'
import { Box, Typography, useTheme } from '@mui/material'

interface ProxmoxHostBoxData {
  hostName: string
  clusterName?: string
  connectionId?: string
  hostId?: string
  width: number
  height: number
}

export function ProxmoxHostBox({ data }: { data: ProxmoxHostBoxData }) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const borderColor = isDark ? 'rgba(255,165,0,0.3)' : 'rgba(200,120,0,0.25)'
  const headerBg = isDark ? 'rgba(255,165,0,0.08)' : 'rgba(200,120,0,0.05)'

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        border: '1.5px solid',
        borderColor,
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: isDark ? 'rgba(255,165,0,0.02)' : 'rgba(200,120,0,0.01)',
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 0.5,
          bgcolor: headerBg,
          borderBottom: '1px solid',
          borderColor,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          height: 40,
        }}
      >
        <i className="ri-server-line" style={{ fontSize: 14, opacity: 0.7, color: '#ff9800' }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }} noWrap>
            {data.hostName}
          </Typography>
          {data.clusterName && (
            <Typography variant="caption" sx={{ opacity: 0.6, fontSize: '0.65rem', display: 'block' }} noWrap>
              {data.clusterName}
            </Typography>
          )}
        </Box>
      </Box>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </Box>
  )
}
