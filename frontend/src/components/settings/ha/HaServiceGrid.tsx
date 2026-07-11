'use client'

import { Box, Tooltip, Typography } from '@mui/material'

const SERVICES = ['etcd', 'patroni', 'haproxy', 'frontend', 'orchestrator', 'weasyprint', 'keepalived']

interface HaServiceGridProps {
  services: Record<string, Record<string, string>>
  nodeNames: string[]
}

function StatusDot({ status }: { status: string | undefined }) {
  const color = status === 'running' ? 'success.main'
    : status === 'unknown' ? 'action.disabled'
    : 'error.main'
  const label = status || 'unknown'

  return (
    <Tooltip
      title={label}
      arrow
      slotProps={{
        tooltip: {
          sx: {
            bgcolor: 'background.paper',
            color: 'text.primary',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: 3,
            fontSize: '0.75rem',
          }
        },
        arrow: {
          sx: { color: 'background.paper' }
        }
      }}
    >
      <Box sx={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        bgcolor: color,
        mx: 'auto',
      }} />
    </Tooltip>
  )
}

export default function HaServiceGrid({ services, nodeNames }: HaServiceGridProps) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: `120px repeat(${nodeNames.length}, 1fr)`, gap: 1, alignItems: 'center', minWidth: 400 }}>
        <Box />
        {nodeNames.map(name => (
          <Typography key={name} variant="caption" sx={{ textAlign: 'center', fontWeight: 600 }}>
            {name}
          </Typography>
        ))}
        {SERVICES.map(svc => (
          <Box key={svc} sx={{ display: 'contents' }}>
            <Typography variant="caption">{svc}</Typography>
            {nodeNames.map(name => (
              <StatusDot key={`${svc}-${name}`} status={services[name]?.[svc]} />
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
