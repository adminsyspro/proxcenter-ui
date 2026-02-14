'use client'

import { memo } from 'react'

import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Box, Typography } from '@mui/material'

import type { VlanContainerNodeData } from '../../types'
import { getVmStatusColor } from '../../lib/topologyColors'

const VLAN_COLORS = ['#1976d2', '#7b1fa2', '#00838f', '#c62828', '#2e7d32', '#f57c00']

function getVlanColor(tag: number | null): string {
  if (tag == null) return '#9e9e9e'

  return VLAN_COLORS[tag % VLAN_COLORS.length]
}

function VlanContainerNodeComponent({ data }: NodeProps) {
  const d = data as unknown as VlanContainerNodeData
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
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        cursor: 'pointer',
        overflow: 'hidden',
        '&:hover': {
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        },
      }}
    >
      <Handle type='target' position={Position.Top} style={{ background: color }} />

      {/* Header */}
      <Box
        sx={{
          px: 1.5,
          py: 0.75,
          bgcolor: `${color}18`,
          borderBottom: '1px solid',
          borderColor: `${color}40`,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
        }}
      >
        <i className='ri-router-line' style={{ fontSize: 15, color }} />
        <Typography variant='caption' fontWeight={700} sx={{ flex: 1 }}>
          {d.label}
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
          {d.vms.length}
        </Typography>
      </Box>

      {/* VM list */}
      <Box sx={{ px: 1, py: 0.5, flex: 1, overflow: 'hidden' }}>
        {d.vms.map((vm) => {
          const statusColor = getVmStatusColor(vm.vmStatus)

          return (
            <Box
              key={`${vm.nodeName}-${vm.vmid}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                py: 0.3,
              }}
            >
              <Box
                sx={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  bgcolor: statusColor,
                  flexShrink: 0,
                }}
              />
              <i
                className={vm.vmType === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'}
                style={{ fontSize: 11, color: statusColor, flexShrink: 0 }}
              />
              <Typography
                variant='caption'
                noWrap
                sx={{ flex: 1, fontSize: '0.65rem', fontWeight: 500, lineHeight: 1.3 }}
              >
                {vm.name}
              </Typography>
              <Typography
                variant='caption'
                color='text.secondary'
                sx={{ fontSize: '0.55rem', flexShrink: 0 }}
              >
                {vm.vmid}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

export const VlanContainerNode = memo(VlanContainerNodeComponent)
