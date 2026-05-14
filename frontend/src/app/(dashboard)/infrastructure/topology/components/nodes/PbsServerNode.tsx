'use client'

import { memo } from 'react'

import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Box, Typography, LinearProgress } from '@mui/material'

import type { PbsServerNodeData } from '../../types'
import { getStatusColor, getStatusBorderColor } from '../../lib/topologyColors'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))


return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function PbsServerNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PbsServerNodeData
  const usagePct = d.totalSize > 0 ? d.totalUsed / d.totalSize : 0
  const status = d.status === 'online' ? (usagePct > 0.9 ? 'critical' : usagePct > 0.7 ? 'warning' : 'ok') : 'offline'

  return (
    <Box
      sx={{
        width: d.width,
        height: d.height,
        bgcolor: 'background.paper',
        border: '2px solid',
        borderColor: getStatusBorderColor(status),
        borderRadius: 2,
        px: 1.5,
        py: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        cursor: 'pointer',
        '&:hover': {
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        },
      }}
    >
      <Handle type='target' position={Position.Top} style={{ background: '#666' }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <i className='ri-hard-drive-3-line' style={{ fontSize: 16, color: '#26a269', flexShrink: 0 }} />
        <Typography variant='body2' fontWeight={700} noWrap sx={{ flex: 1 }}>
          {d.label}
        </Typography>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: getStatusColor(status),
            flexShrink: 0,
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Typography variant='caption' color='text.secondary'>
          {d.datastoreCount} datastore{d.datastoreCount > 1 ? 's' : ''}
        </Typography>
        <Typography variant='caption' color='text.secondary'>
          {d.backupCount} backup{d.backupCount > 1 ? 's' : ''}
        </Typography>
      </Box>

      <Box sx={{ mt: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
          <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.65rem' }}>
            Storage
          </Typography>
          <Typography variant='caption' sx={{ fontSize: '0.65rem', ml: 'auto' }}>
            {formatBytes(d.totalUsed)} / {formatBytes(d.totalSize)}
          </Typography>
        </Box>
        <LinearProgress
          variant='determinate'
          value={Math.min(usagePct * 100, 100)}
          sx={{
            height: 4,
            borderRadius: 2,
            bgcolor: 'action.hover',
            '& .MuiLinearProgress-bar': {
              bgcolor: getStatusColor(status),
              borderRadius: 2,
            },
          }}
        />
      </Box>

      <Handle type='source' position={Position.Bottom} style={{ background: '#666' }} />
    </Box>
  )
}

export const PbsServerNode = memo(PbsServerNodeComponent)
