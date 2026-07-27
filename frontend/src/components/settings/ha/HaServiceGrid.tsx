'use client'

import { Box, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { tooltipSlotProps } from './tooltipSlotProps'

const SERVICES: { name: string; icon: string }[] = [
  { name: 'etcd', icon: 'ri-database-2-line' },
  { name: 'patroni', icon: 'ri-shield-check-line' },
  { name: 'haproxy', icon: 'ri-route-line' },
  { name: 'frontend', icon: 'ri-window-line' },
  { name: 'orchestrator', icon: 'ri-settings-3-line' },
  { name: 'weasyprint', icon: 'ri-file-pdf-2-line' },
  { name: 'keepalived', icon: 'ri-heart-pulse-line' },
]

interface HaServiceGridProps {
  services: Record<string, Record<string, string>>
  nodeNames: string[]
}

function StatusIcon({ status }: { status: string | undefined }) {
  const t = useTranslations('ha')
  const isRunning = status === 'running'
  const isUnknown = !status || status === 'unknown'
  const label = status || t('services.statusUnknown')
  const icon = isRunning ? 'ri-check-line' : isUnknown ? 'ri-question-line' : 'ri-close-line'
  const color = isRunning ? 'success.main' : isUnknown ? 'action.disabled' : 'error.main'

  return (
    <Tooltip title={label} arrow slotProps={tooltipSlotProps}>
      <Box sx={{ textAlign: 'center', color, lineHeight: 1 }}>
        <i className={icon} style={{ fontSize: 16 }} />
      </Box>
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
          <Box key={svc.name} sx={{ display: 'contents' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className={svc.icon} style={{ fontSize: 14, opacity: 0.7 }} />
              <Typography variant="caption">{svc.name}</Typography>
            </Box>
            {nodeNames.map(name => (
              <StatusIcon key={`${svc.name}-${name}`} status={services[name]?.[svc.name]} />
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
