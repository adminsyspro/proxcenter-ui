'use client'

import { memo } from 'react'

import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Box, Typography } from '@mui/material'

import type { VmNodeData } from '../../types'
import { getVmStatusColor } from '../../lib/topologyColors'

function VmNodeComponent({ data }: NodeProps) {
  const d = data as unknown as VmNodeData
  const statusColor = getVmStatusColor(d.vmStatus)

  return (
    <Box
      sx={{
        width: d.width,
        height: d.height,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderLeftWidth: 3,
        borderLeftColor: statusColor,
        borderRadius: 1.5,
        px: 1,
        py: 0.5,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        cursor: 'pointer',
        '&:hover': {
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        },
      }}
    >
      <Handle type='target' position={Position.Top} style={{ background: '#999' }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <img src='/images/proxcenter-logo.svg' alt='' width={12} height={12} style={{ flexShrink: 0, opacity: 0.7 }} />
        <i
          className={d.vmType === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'}
          style={{ fontSize: 13, color: statusColor }}
        />
        <Typography variant='caption' fontWeight={600} noWrap sx={{ flex: 1, fontSize: '0.7rem' }}>
          {d.label}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
        <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.6rem' }}>
          {d.vmid}
        </Typography>
        <Typography
          variant='caption'
          sx={{
            fontSize: '0.6rem',
            color: statusColor,
            fontWeight: 500,
          }}
        >
          {d.vmStatus}
        </Typography>
      </Box>
    </Box>
  )
}

export const VmNode = memo(VmNodeComponent)
