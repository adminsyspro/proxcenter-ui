'use client'

import { Box, Button, Chip, CircularProgress, IconButton, LinearProgress, Paper, Skeleton, Stack, Tooltip, Typography, alpha, useTheme } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { FirewallCoverage } from '@/hooks/useZeroTrust'

import { coveragePercent } from './dashboardModel'
import { NOW_REFRESH_MS, useNow } from './microseg/useNow'

type Props = {
  coverage: FirewallCoverage | null
  error: Error | undefined
  refreshing: boolean
  onRefresh: () => void
  onDetails: () => void
}

const GREEN = '#22c55e'
const RED = '#ef4444'
const GREY = '#94a3b8'

/** Same footprint as the figures: the chips row and the rate bar. */
function CoverageSkeleton() {
  return (
    <Stack spacing={2} data-testid='coverage-loading'>
      <Stack direction='row' spacing={1.5}>
        <Skeleton variant='rounded' width={150} height={28} />
        <Skeleton variant='rounded' width={120} height={28} />
      </Stack>
      <Box>
        <Skeleton variant='text' width='100%' height={20} />
        <Skeleton variant='rounded' height={10} />
      </Box>
    </Stack>
  )
}

function CoverageFiguresView({ coverage }: { coverage: FirewallCoverage }) {
  const t = useTranslations()
  const percent = coveragePercent(coverage)

  if (coverage.total === 0) {
    return <Typography variant='body2' color='text.secondary'>{t('networkPage.dashboard.coverageNone')}</Typography>
  }

  return (
    <Stack spacing={2}>
      <Stack direction='row' spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Chip
          icon={<i className='ri-shield-check-line' style={{ fontSize: 14, color: GREEN }} />}
          label={`${t('networkPage.protectedCount')}: ${coverage.enabled}/${coverage.measured}`}
          size='small'
          sx={{ height: 28, fontWeight: 600, bgcolor: alpha(GREEN, 0.15), '& .MuiChip-label': { fontSize: 12 } }}
        />
        {coverage.disabled > 0 && (
          <Chip
            icon={<i className='ri-error-warning-line' style={{ fontSize: 14, color: RED }} />}
            label={`${t('networkPage.unprotectedCount')}: ${coverage.disabled}`}
            size='small'
            sx={{ height: 28, fontWeight: 600, bgcolor: alpha(RED, 0.15), color: RED, '& .MuiChip-label': { fontSize: 12 } }}
          />
        )}
        {coverage.unknown > 0 && (
          <Tooltip title={t('networkPage.dashboard.coverageUnknownHint')}>
            <Chip
              icon={<i className='ri-question-line' style={{ fontSize: 14 }} />}
              label={t('networkPage.dashboard.coverageUnknown', { count: coverage.unknown })}
              size='small'
              sx={{ height: 28, fontWeight: 600, bgcolor: alpha(GREY, 0.18), '& .MuiChip-label': { fontSize: 12 } }}
            />
          </Tooltip>
        )}
      </Stack>
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, gap: 1 }}>
          <Typography variant='body2' sx={{ color: 'text.secondary' }} noWrap>
            {t('networkPage.protectionRate')}
            {coverage.sampled && ` · ${t('networkPage.dashboard.coverageSample', { measured: coverage.measured, total: coverage.total })}`}
          </Typography>
          <Typography variant='body2' sx={{ fontWeight: 700 }}>{percent === null ? '-' : `${Math.round(percent)}%`}</Typography>
        </Box>
        <LinearProgress
          variant='determinate'
          value={percent ?? 0}
          sx={{ height: 10, borderRadius: 5, bgcolor: alpha(RED, 0.2), '& .MuiLinearProgress-bar': { bgcolor: GREEN, borderRadius: 5 } }}
        />
      </Box>
    </Stack>
  )
}

/**
 * Guest firewall coverage of the Dashboard: figures the server computed (and keeps 10 minutes), when they were
 * computed, and a button to compute them again. A skeleton of the same height while nothing is known yet.
 */
export default function DashboardCoverage({ coverage, error, refreshing, onRefresh, onDetails }: Props) {
  const t = useTranslations()
  const format = useFormatter()
  const theme = useTheme()
  const now = useNow(NOW_REFRESH_MS, coverage?.computedAt)
  const computedAt = coverage?.computedAt ? new Date(coverage.computedAt) : null
  const busy = refreshing || !!coverage?.computing

  let caption: string | null = null
  if (busy) caption = t('networkPage.dashboard.coverageComputing')
  else if (computedAt && !Number.isNaN(computedAt.getTime())) caption = t('networkPage.dashboard.coverageComputedAgo', { time: format.relativeTime(computedAt, now) })

  let body = <CoverageSkeleton />
  if (coverage && computedAt) body = <CoverageFiguresView coverage={coverage} />
  else if (error) body = <Typography variant='body2' color='text.secondary'>{t('networkPage.dashboard.coverageUnavailable', { error: error.message })}</Typography>

  return (
    <Paper sx={{ p: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}`, mb: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Typography variant='subtitle2' sx={{ fontWeight: 700, color: 'text.secondary', flexShrink: 0 }}>
            {t('networkPage.vmFirewallCoverage')}
          </Typography>
          {caption && (
            <Typography variant='caption' color='text.secondary' noWrap data-testid='coverage-caption'>{caption}</Typography>
          )}
          <Tooltip title={t('networkPage.dashboard.coverageRefresh')}>
            <span>
              <IconButton size='small' aria-label={t('networkPage.dashboard.coverageRefresh')} onClick={onRefresh} disabled={busy}>
                {busy ? <CircularProgress size={14} /> : <i className='ri-refresh-line' style={{ fontSize: 16 }} />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        <Button size='small' onClick={onDetails} endIcon={<i className='ri-arrow-right-line' />} sx={{ flexShrink: 0 }}>
          {t('networkPage.viewDetails')}
        </Button>
      </Box>
      {body}
    </Paper>
  )
}
