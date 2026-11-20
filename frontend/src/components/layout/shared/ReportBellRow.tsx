'use client'

import { useTranslations } from 'next-intl'
import { Box, Chip, IconButton, ListItemIcon, Tooltip, Typography } from '@mui/material'

import type { ReportBellItem } from '@/lib/compliance/report/reportBellItems'

interface ReportBellRowProps {
  item: ReportBellItem
  onDownload: (item: ReportBellItem) => void
  onDismiss: (item: ReportBellItem) => void
}

/**
 * A background compliance report in the notification bell: ready (a click
 * downloads the PDF) or failed (with why). Same row shape as the DRS and
 * alert rows of the bell.
 */
export default function ReportBellRow({ item, onDownload, onDismiss }: ReportBellRowProps) {
  const t = useTranslations('compliance.frameworks')
  const ready = item.status === 'done' && !!item.downloadUrl
  const color = item.status === 'done' ? 'info' : 'warning'

  return (
    <Box
      data-testid='report-bell-row'
      sx={{
        display: 'flex',
        alignItems: 'center',
        py: 1.5,
        px: 2,
        borderLeft: '3px solid',
        borderColor: `${color}.main`,
        cursor: ready ? 'pointer' : 'default',
        '&:hover': { bgcolor: 'action.hover' }
      }}
      onClick={() => { if (ready) onDownload(item) }}
    >
      <ListItemIcon sx={{ minWidth: 36 }}>
        <i className='ri-file-pdf-2-line' style={{ color: `var(--mui-palette-${color}-main)`, fontSize: 20 }} />
      </ListItemIcon>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant='body2' noWrap sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
          {item.status === 'done' ? t('reportReady', { report: item.label }) : item.label}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, minWidth: 0 }}>
          <Chip
            size='small'
            label={t('reportChip')}
            color={color}
            sx={{ height: 16, fontSize: '0.55rem', fontWeight: 700, flexShrink: 0 }}
          />
          <Typography variant='caption' noWrap title={item.status === 'error' ? item.error : undefined} sx={{ opacity: 0.6, fontSize: '0.65rem' }}>
            {item.status === 'error' ? item.error || t('reportFailed') : item.connectionName}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', ml: 1 }}>
        {ready && (
          <Tooltip title={t('reportDownload')}>
            <IconButton
              size='small'
              aria-label={t('reportDownload')}
              onClick={(e) => { e.stopPropagation(); onDownload(item) }}
              sx={{ opacity: 0.7, '&:hover': { opacity: 1, color: 'info.main' } }}
            >
              <i className='ri-download-2-line' style={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t('reportDismiss')}>
          <IconButton
            size='small'
            aria-label={t('reportDismiss')}
            onClick={(e) => { e.stopPropagation(); onDismiss(item) }}
            sx={{ opacity: 0.7, '&:hover': { opacity: 1 } }}
          >
            <i className='ri-close-line' style={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  )
}
