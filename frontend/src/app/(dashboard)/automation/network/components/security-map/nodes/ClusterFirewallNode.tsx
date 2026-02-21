'use client'

import { memo } from 'react'

import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Box, Typography } from '@mui/material'

import type { ClusterFirewallNodeData } from '../types'

function ClusterFirewallNodeComponent({ data }: NodeProps) {
  const d = data as unknown as ClusterFirewallNodeData

  return (
    <Box
      sx={{
        width: d.width,
        height: d.height,
        bgcolor: 'background.paper',
        border: '2px solid',
        borderColor: d.enabled ? '#4caf50' : '#9e9e9e',
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.25,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        cursor: 'pointer',
      }}
    >
      <Handle type='target' position={Position.Left} style={{ background: d.enabled ? '#4caf50' : '#9e9e9e' }} />
      <Handle type='source' position={Position.Right} style={{ background: d.enabled ? '#4caf50' : '#9e9e9e' }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <i className='ri-shield-flash-line' style={{ fontSize: 16, color: d.enabled ? '#4caf50' : '#9e9e9e' }} />
        <Typography variant='caption' fontWeight={700} sx={{ fontSize: '0.65rem' }}>
          {d.label}
        </Typography>
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: d.enabled ? '#4caf50' : '#f44336',
          }}
        />
      </Box>

      <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.55rem' }}>
        IN:{d.policyIn} OUT:{d.policyOut} • {d.ruleCount} rules
      </Typography>
    </Box>
  )
}

export const ClusterFirewallNode = memo(ClusterFirewallNodeComponent)
