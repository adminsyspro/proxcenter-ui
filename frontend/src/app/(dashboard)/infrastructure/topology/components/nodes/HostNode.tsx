'use client'

import { memo } from 'react'

import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Box, Typography, LinearProgress } from '@mui/material'

import type { HostNodeData } from '../../types'
import { getStatusColor, getStatusBorderColor, getResourceStatus } from '../../lib/topologyColors'

function HostNodeComponent({ data }: NodeProps) {
  const d = data as unknown as HostNodeData
  const maxUsage = Math.max(d.cpuUsage, d.ramUsage)
  const resourceStatus = getResourceStatus(maxUsage, d.status !== 'offline')

  return (
    <Box
      sx={{
        width: d.width,
        height: d.height,
        bgcolor: 'background.paper',
        border: '2px solid',
        borderColor: getStatusBorderColor(resourceStatus),
        borderRadius: 2,
        px: 1.5,
        py: 0.75,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxShadow: '0 1px 6px rgba(0,0,0,0.1)',
        cursor: 'pointer',
        '&:hover': {
          boxShadow: '0 3px 12px rgba(0,0,0,0.15)',
        },
      }}
    >
      <Handle type='target' position={Position.Top} style={{ background: '#666' }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: getStatusColor(d.status),
            flexShrink: 0,
          }}
        />
        <Typography variant='body2' fontWeight={600} noWrap sx={{ flex: 1, fontSize: '0.8rem' }}>
          {d.label}
        </Typography>
        <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.65rem' }}>
          {d.vmCount} VMs
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.6rem' }}>
            CPU {(d.cpuUsage * 100).toFixed(0)}%
          </Typography>
          <LinearProgress
            variant='determinate'
            value={Math.min(d.cpuUsage * 100, 100)}
            sx={{
              height: 3,
              borderRadius: 2,
              bgcolor: 'action.hover',
              '& .MuiLinearProgress-bar': {
                bgcolor: getStatusColor(getResourceStatus(d.cpuUsage, d.status !== 'offline')),
                borderRadius: 2,
              },
            }}
          />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.6rem' }}>
            RAM {(d.ramUsage * 100).toFixed(0)}%
          </Typography>
          <LinearProgress
            variant='determinate'
            value={Math.min(d.ramUsage * 100, 100)}
            sx={{
              height: 3,
              borderRadius: 2,
              bgcolor: 'action.hover',
              '& .MuiLinearProgress-bar': {
                bgcolor: getStatusColor(getResourceStatus(d.ramUsage, d.status !== 'offline')),
                borderRadius: 2,
              },
            }}
          />
        </Box>
      </Box>

      <Handle type='source' position={Position.Bottom} style={{ background: '#666' }} />
    </Box>
  )
}

export const HostNode = memo(HostNodeComponent)
