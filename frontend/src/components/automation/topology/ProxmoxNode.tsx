'use client'

import { Handle, Position } from '@xyflow/react'
import { Box, Typography, LinearProgress, alpha, useTheme } from '@mui/material'

interface ProxmoxNodeData {
  label: string
  status: string
  cpu: number
  memory: number
  vms: number
  runningVms: number
  [key: string]: unknown
}

const pct = (v: number) => Math.max(0, Math.min(100, v))

export default function ProxmoxNode({ data }: { data: ProxmoxNodeData }) {
  const theme = useTheme()

  const statusColor = data.status === 'online'
    ? theme.palette.success.main
    : data.status === 'warning' || data.status === 'maintenance'
      ? theme.palette.warning.main
      : theme.palette.error.main

  const cpuColor = data.cpu > 85
    ? theme.palette.error.main
    : data.cpu > 70
      ? theme.palette.warning.main
      : theme.palette.primary.main

  const memColor = data.memory > 85
    ? theme.palette.error.main
    : data.memory > 70
      ? theme.palette.warning.main
      : theme.palette.success.main

  return (
    <Box sx={{
      bgcolor: 'background.paper',
      border: '1px solid',
      borderColor: data.status === 'offline' ? alpha(theme.palette.error.main, 0.3) : 'divider',
      borderRadius: 2,
      p: 1.5,
      minWidth: 180,
      opacity: data.status === 'offline' ? 0.6 : 1,
      boxShadow: `0 2px 8px ${alpha(theme.palette.common.black, 0.08)}`,
    }}>
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: theme.palette.divider,
          width: 8,
          height: 8,
          border: `2px solid ${theme.palette.background.paper}`,
        }}
      />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: statusColor,
          boxShadow: `0 0 6px ${alpha(statusColor, 0.5)}`,
          flexShrink: 0,
        }} />
        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }} noWrap>
          {data.label}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {/* CPU */}
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
            <Typography variant="caption" sx={{ opacity: 0.6, fontSize: '0.65rem' }}>CPU</Typography>
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', fontFamily: 'var(--font-mono, monospace)' }}>
              {data.cpu.toFixed(0)}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={pct(data.cpu)}
            sx={{
              height: 5,
              borderRadius: 3,
              bgcolor: alpha(cpuColor, 0.12),
              '& .MuiLinearProgress-bar': {
                borderRadius: 3,
                bgcolor: cpuColor,
              },
            }}
          />
        </Box>

        {/* MEM */}
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
            <Typography variant="caption" sx={{ opacity: 0.6, fontSize: '0.65rem' }}>MEM</Typography>
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', fontFamily: 'var(--font-mono, monospace)' }}>
              {data.memory.toFixed(0)}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={pct(data.memory)}
            sx={{
              height: 5,
              borderRadius: 3,
              bgcolor: alpha(memColor, 0.12),
              '& .MuiLinearProgress-bar': {
                borderRadius: 3,
                bgcolor: memColor,
              },
            }}
          />
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1, opacity: 0.6 }}>
        <i className="ri-instance-line" style={{ fontSize: 12 }} />
        <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>
          {data.runningVms}/{data.vms} VMs
        </Typography>
      </Box>
    </Box>
  )
}
