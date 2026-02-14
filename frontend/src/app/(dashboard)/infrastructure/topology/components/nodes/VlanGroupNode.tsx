'use client'

import { memo } from 'react'

import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Box, Typography } from '@mui/material'

import type { VlanGroupNodeData } from '../../types'

const VLAN_COLORS = ['#1976d2', '#7b1fa2', '#00838f', '#c62828', '#2e7d32', '#f57c00']

function getVlanColor(tag: number | null): string {
  if (tag == null) return '#9e9e9e'

  return VLAN_COLORS[tag % VLAN_COLORS.length]
}

function VlanGroupNodeComponent({ data }: NodeProps) {
  const d = data as unknown as VlanGroupNodeData
  const color = getVlanColor(d.vlanTag)

  return (
    <Box
      sx={{
        width: d.width,
        height: d.height,
        bgcolor: 'background.paper',
        border: '2px solid',
        borderColor: color,
        borderRadius: 2,
        px: 1.5,
        py: 0.75,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        cursor: 'pointer',
        '&:hover': {
          boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
        },
      }}
    >
      <Handle type='target' position={Position.Top} style={{ background: color }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <i className='ri-router-line' style={{ fontSize: 15, color }} />
        <Typography variant='caption' fontWeight={700} noWrap sx={{ flex: 1 }}>
          {d.vlanTag != null ? `VLAN ${d.vlanTag}` : 'No VLAN'}
        </Typography>
        <Typography
          variant='caption'
          sx={{
            bgcolor: color,
            color: '#fff',
            borderRadius: 1,
            px: 0.75,
            py: 0.1,
            fontSize: '0.6rem',
            fontWeight: 700,
          }}
        >
          {d.vmCount}
        </Typography>
      </Box>

      <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.6rem', mt: 0.25 }}>
        {d.bridge}
      </Typography>

      <Handle type='source' position={Position.Bottom} style={{ background: color }} />
    </Box>
  )
}

export const VlanGroupNode = memo(VlanGroupNodeComponent)
