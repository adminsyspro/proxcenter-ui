'use client'

import { useTranslations } from 'next-intl'
import { Box, Typography } from '@mui/material'

import { healthDetailMessages } from '@/lib/ceph/osdFlagsView'

/*
   The detail lines of one Ceph health check, under its summary (ui#1164):
   `host pve3 has flags noout` is what makes a per-host flag visible under
   the OSD_FLAGS warning. Long checks are cut after a few lines.
*/

export const HEALTH_DETAIL_MAX_LINES = 5

export default function CephHealthCheckDetail({ detail, max = HEALTH_DETAIL_MAX_LINES }: Readonly<{ detail: unknown; max?: number }>) {
  const t = useTranslations()
  const lines = healthDetailMessages(detail)

  if (lines.length === 0) return null

  const shown = lines.slice(0, max)
  const hidden = lines.length - shown.length

  return (
    <Box data-testid='ceph-health-detail' sx={{ mt: 0.5 }}>
      {shown.map((line, index) => (
        <Typography key={`${index}:${line}`} variant='caption' color='text.secondary' sx={{ display: 'block', lineHeight: 1.3 }}>
          {line}
        </Typography>
      ))}
      {hidden > 0 && (
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', lineHeight: 1.3 }}>
          {t('ceph.healthDetailMore', { count: hidden })}
        </Typography>
      )}
    </Box>
  )
}
