'use client'

import { memo } from 'react'

import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Box, Tooltip, Typography } from '@mui/material'

import type { SecurityZoneNodeData } from '../types'
import { getZoneColor, getVmProtectionColor, getVmStatusColor } from '../lib/securityMapColors'

function SecurityZoneNodeComponent({ data }: NodeProps) {
  const d = data as unknown as SecurityZoneNodeData
  const color = getZoneColor(d.zoneIndex)

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
      <Handle type='target' position={Position.Left} style={{ background: color }} />
      <Handle type='source' position={Position.Right} style={{ background: color }} />

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
          gap: 0.5,
        }}
      >
        <i className='ri-shield-keyhole-line' style={{ fontSize: 14, color }} />
        <Typography variant='caption' fontWeight={700} noWrap sx={{ flex: 1 }}>
          {d.label}
        </Typography>
        <Typography
          variant='caption'
          sx={{
            fontSize: '0.55rem',
            fontFamily: 'JetBrains Mono, monospace',
            color: 'text.secondary',
          }}
        >
          {d.cidr}
        </Typography>
        {d.hasGateway && (
          <Tooltip title="Gateway alias">
            <Box component='span' sx={{ fontSize: 11, color: '#4caf50' }}>
              <i className='ri-router-line' />
            </Box>
          </Tooltip>
        )}
        {d.hasBaseSg && (
          <Tooltip title="Base SG">
            <Box component='span' sx={{ fontSize: 11, color: '#2196f3' }}>
              <i className='ri-shield-check-line' />
            </Box>
          </Tooltip>
        )}
        <Typography
          variant='caption'
          sx={{
            bgcolor: color,
            color: '#fff',
            borderRadius: 1,
            px: 0.5,
            py: 0.1,
            fontSize: '0.55rem',
            fontWeight: 700,
            minWidth: 16,
            textAlign: 'center',
          }}
        >
          {d.vms.length}
        </Typography>
      </Box>

      {/* VM list */}
      <Box sx={{ px: 1, py: 0.5, flex: 1, overflow: 'hidden' }}>
        {d.vms.length === 0 && (
          <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.6rem', fontStyle: 'italic' }}>
            No VMs
          </Typography>
        )}
        {d.vms.map((vm) => {
          const statusColor = getVmStatusColor(vm.status)
          const protectionColor = getVmProtectionColor(vm.isIsolated, vm.firewallEnabled)

          return (
            <Box
              key={`${vm.node}-${vm.vmid}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                py: 0.15,
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
              <Typography
                variant='caption'
                noWrap
                sx={{ flex: 1, fontSize: '0.6rem', fontWeight: 500, lineHeight: 1.3 }}
              >
                {vm.name}
              </Typography>
              <Tooltip title={vm.isIsolated ? 'Isolated' : vm.firewallEnabled ? 'Firewall active' : 'Unprotected'}>
                <Box component='span' sx={{ fontSize: 10, color: protectionColor, flexShrink: 0 }}>
                  <i className='ri-shield-line' />
                </Box>
              </Tooltip>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

export const SecurityZoneNode = memo(SecurityZoneNodeComponent)
