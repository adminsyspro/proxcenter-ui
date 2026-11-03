'use client'

import { Box, Chip, CircularProgress, IconButton, LinearProgress, Stack, Tooltip, Typography, alpha } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { FirewallCoverage } from '@/hooks/useZeroTrust'

import DashboardStateCard, { STATE_AMBER, STATE_GREEN, STATE_GREY, STATE_RED, StateRow } from './DashboardStateCard'
import { guestTotals, type GuestTotals } from './dashboardModel'
import { NOW_REFRESH_MS, useNow } from './microseg/useNow'

type Props = {
  coverage: FirewallCoverage | null
  error: Error | undefined
  refreshing: boolean
  onRefresh: () => void
  /** Opens Firewalling > VMs. */
  onOpen: () => void
}

/** The server serves a forced refresh from its cache this soon after new figures (COVERAGE_FORCE_MIN_MS, server side). */
const REFRESH_FLOOR_MS = 30_000
/** How often the refresh button checks whether that floor is over. */
const FLOOR_TICK_MS = 5_000

function CoverageFiguresView({ totals }: { totals: GuestTotals }) {
  const t = useTranslations('networkPage.dashboard')
  const known = totals.protected + totals.unprotected
  const percent = known > 0 ? (totals.protected / known) * 100 : null

  if (totals.total === 0) {
    return <Typography variant='body2' color='text.secondary'>{t('coverageNone')}</Typography>
  }

  return (
    <Stack spacing={1.25}>
      <StateRow label={t('coverageProtectedLabel')} testId='coverage-protected'>
        <Tooltip title={t('coverageDefinition')}>
          <Typography variant='body2' sx={{ fontWeight: 600 }}>{t('coverageProtected', { protected: totals.protected, total: totals.total })}</Typography>
        </Tooltip>
        {totals.running !== null && totals.stopped !== null && (
          <Typography variant='body2' color='text.secondary' data-testid='coverage-states'>
            {t('coverageStates', { running: totals.running, stopped: totals.stopped })}
          </Typography>
        )}
      </StateRow>
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, gap: 1, minWidth: 0 }}>
          <Typography variant='caption' color='text.secondary' noWrap>
            {totals.sampled ? t('coverageSample', { measured: totals.measured, total: totals.total }) : t('coverageRate')}
          </Typography>
          <Typography variant='caption' sx={{ fontWeight: 700 }}>{percent === null ? '-' : `${Math.round(percent)}%`}</Typography>
        </Box>
        <LinearProgress
          variant='determinate'
          value={percent ?? 0}
          aria-label={t('coverageRate')}
          sx={{ height: 8, borderRadius: 4, bgcolor: alpha(percent === null ? STATE_GREY : STATE_RED, 0.2), '& .MuiLinearProgress-bar': { bgcolor: STATE_GREEN, borderRadius: 4 } }}
        />
      </Box>
      {(totals.unprotected > 0 || totals.unknown > 0) && (
        <Stack direction='row' spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {totals.unprotected > 0 && (
            <Chip
              size='small'
              icon={<i className='ri-error-warning-line' style={{ fontSize: 14 }} />}
              label={t('coverageUnprotected', { count: totals.unprotected })}
              sx={{ height: 24, fontWeight: 600, bgcolor: alpha(STATE_RED, 0.15), color: STATE_RED, '& .MuiChip-icon': { color: 'inherit' } }}
            />
          )}
          {totals.unknown > 0 && (
            <Tooltip title={t('coverageUnknownHint')}>
              <Chip
                size='small'
                icon={<i className='ri-question-line' style={{ fontSize: 14 }} />}
                label={t('coverageUnknown', { count: totals.unknown })}
                sx={{ height: 24, fontWeight: 600, bgcolor: alpha(STATE_GREY, 0.18) }}
              />
            </Tooltip>
          )}
        </Stack>
      )}
    </Stack>
  )
}

/**
 * Guest firewall coverage, one of the three state cards of the Dashboard: protected guests of the inventory's total,
 * running and stopped from the same list, figures the server computed (and keeps 10 minutes), when they were
 * computed, and a button to compute them again, held for 30 s after new figures (the server floor).
 */
export default function DashboardCoverage({ coverage, error, refreshing, onRefresh, onOpen }: Props) {
  const t = useTranslations('networkPage.dashboard')
  const format = useFormatter()
  const now = useNow(FLOOR_TICK_MS, coverage?.computedAt)
  const relativeNow = useNow(NOW_REFRESH_MS, coverage?.computedAt)
  const computedAt = coverage?.computedAt ? new Date(coverage.computedAt) : null
  const valid = !!computedAt && !Number.isNaN(computedAt.getTime())
  const busy = refreshing || !!coverage?.computing
  const tooSoon = valid && now - computedAt.getTime() < REFRESH_FLOOR_MS
  const totals = valid ? guestTotals(coverage) : null

  let caption: string | null = null
  if (busy) caption = t('coverageComputing')
  else if (valid) caption = t('coverageComputedAgo', { time: format.relativeTime(computedAt, Math.max(relativeNow, computedAt.getTime())) })

  let accent = STATE_GREY
  if (totals && totals.total > 0) {
    if (totals.unprotected === 0 && totals.unknown === 0) accent = STATE_GREEN
    else accent = totals.protected === 0 ? STATE_RED : STATE_AMBER
  }

  let body: React.ReactNode = null
  if (totals) body = <CoverageFiguresView totals={totals} />
  else if (error) body = <Typography variant='body2' color='text.secondary'>{t('coverageUnavailable', { error: error.message })}</Typography>

  const refreshTip = tooSoon && !busy ? t('coverageRefreshSoon') : t('coverageRefresh')
  const refresh = (
    <Tooltip title={refreshTip}>
      <span>
        <IconButton size='small' aria-label={t('coverageRefresh')} onClick={onRefresh} disabled={busy || tooSoon}>
          {busy ? <CircularProgress size={14} /> : <i className='ri-refresh-line' style={{ fontSize: 16 }} />}
        </IconButton>
      </span>
    </Tooltip>
  )

  return (
    <DashboardStateCard
      testId='coverage-card'
      icon='ri-computer-line'
      title={t('coverageTitle')}
      accent={accent}
      onOpen={onOpen}
      openLabel={t('open')}
      openAriaLabel={t('openGuests')}
      headerAction={refresh}
      loading={!totals && !error}
    >
      {body}
      {caption && (
        <Typography variant='caption' component='div' color='text.secondary' noWrap data-testid='coverage-caption' sx={{ mt: 1.25 }}>{caption}</Typography>
      )}
    </DashboardStateCard>
  )
}
