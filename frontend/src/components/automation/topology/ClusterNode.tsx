'use client'

import { Handle, Position } from '@xyflow/react'
import { Box, Typography, Chip, alpha, useTheme } from '@mui/material'

interface ClusterNodeData {
  label: string
  status: string
  nodeCount: number
  onlineNodes: number
  totalVMs: number
  avgCpu: number
  avgMemory: number
  [key: string]: unknown
}

export default function ClusterNode({ data }: { data: ClusterNodeData }) {
  const theme = useTheme()

  const statusColor = data.status === 'online'
    ? theme.palette.success.main
    : data.status === 'warning'
      ? theme.palette.warning.main
      : theme.palette.error.main

  return (
    <Box sx={{
      bgcolor: 'background.paper',
      border: '2px solid',
      borderColor: alpha(theme.palette.info.main, 0.4),
      borderRadius: 2,
      p: 2,
      minWidth: 220,
      background: `linear-gradient(135deg, ${alpha(theme.palette.info.main, 0.06)} 0%, ${theme.palette.background.paper} 100%)`,
      boxShadow: `0 4px 20px ${alpha(theme.palette.info.main, 0.1)}`,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <Box sx={{
          width: 32,
          height: 32,
          borderRadius: 1,
          bgcolor: alpha(theme.palette.info.main, 0.12),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <i className="ri-server-line" style={{ fontSize: 18, color: theme.palette.info.main }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
            {data.label}
          </Typography>
        </Box>
        <Box sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: statusColor,
          boxShadow: `0 0 8px ${alpha(statusColor, 0.6)}`,
          flexShrink: 0,
        }} />
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip
          size="small"
          icon={<i className="ri-computer-line" style={{ fontSize: 14 }} />}
          label={`${data.onlineNodes}/${data.nodeCount}`}
          sx={{ height: 22, fontSize: '0.7rem' }}
        />
        <Chip
          size="small"
          icon={<i className="ri-instance-line" style={{ fontSize: 14 }} />}
          label={`${data.totalVMs} VMs`}
          sx={{ height: 22, fontSize: '0.7rem' }}
        />
      </Box>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: theme.palette.info.main,
          width: 8,
          height: 8,
          border: `2px solid ${theme.palette.background.paper}`,
        }}
      />
    </Box>
  )
}
