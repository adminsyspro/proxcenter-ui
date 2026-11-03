'use client'

import { Box, Chip, CircularProgress, Paper, Skeleton, Stack, Tooltip, Typography, alpha, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'

import { STATE_AMBER, STATE_GREEN, STATE_RED } from './DashboardStateCard'
import { scoreBand, type BlockPhase, type ScoreBand, type ScoreComponent, type ZeroTrustScore } from './dashboardModel'

type Props = {
  phase: BlockPhase
  score: ZeroTrustScore
  /** What each component reads, for its line: "On", "DROP", "58 %". */
  values: Record<ScoreComponent['key'], string | null>
}

const BAND_COLOR: Record<ScoreBand, string> = { good: STATE_GREEN, fair: STATE_AMBER, poor: STATE_RED }
const BAND_LABEL: Record<ScoreBand, 'excellent' | 'moderate' | 'toImprove'> = { good: 'excellent', fair: 'moderate', poor: 'toImprove' }
const COMPONENT_LABEL: Record<ScoreComponent['key'], string> = { firewall: 'componentFirewall', policyIn: 'componentPolicyIn', coverage: 'componentCoverage' }

function ScoreSkeleton() {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems='center' data-testid='score-loading'>
      <Skeleton variant='circular' width={96} height={96} />
      <Box sx={{ flex: 1, width: '100%' }}>
        <Skeleton variant='text' width='40%' height={30} />
        <Skeleton variant='text' width='85%' height={22} />
        <Skeleton variant='text' width='70%' height={22} />
      </Box>
    </Stack>
  )
}

/**
 * The Zero Trust score, computed on the figures of the three cards above: cluster firewall on 30, inbound policy DROP
 * 25, guest coverage 45. Every component and its value is listed, beside the gauge and in its tooltip. Until all
 * three are known the gauge stays neutral and says "Not computed", never a verdict on part of them.
 */
export default function ZeroTrustScoreCard({ phase, score, values }: Props) {
  const t = useTranslations('networkPage')
  const theme = useTheme()

  if (phase === 'loading') {
    return (
      <Paper sx={{ p: 2.5, mb: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
        <ScoreSkeleton />
      </Paper>
    )
  }

  const total = phase === 'ready' ? score.total : null
  const band = total === null ? null : scoreBand(total)
  const color = band ? BAND_COLOR[band] : theme.palette.text.disabled

  const line = (c: ScoreComponent) => {
    const label = t(`dashboard.${COMPONENT_LABEL[c.key]}`)
    const value = values[c.key]
    if (c.points === null || value === null) return t('dashboard.scoreLineUnknown', { label })
    return t('dashboard.scoreLine', { label, value, points: c.points, weight: c.weight })
  }
  const tooltip = (
    <Box>
      {score.components.map(c => <Typography key={c.key} variant='caption' component='div'>{line(c)}</Typography>)}
    </Box>
  )

  return (
    <Paper data-testid='zero-trust-card' sx={{ p: 2.5, mb: 3, border: `1px solid ${alpha(color, 0.3)}`, background: `linear-gradient(135deg, ${alpha(color, 0.1)} 0%, transparent 60%)` }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems='center'>
        <Tooltip title={tooltip}>
          <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }} data-testid='zero-trust-gauge'>
            <CircularProgress variant='determinate' value={100} size={96} thickness={3.5} sx={{ color: alpha(color, 0.22) }} />
            <CircularProgress variant='determinate' value={total ?? 0} size={96} thickness={3.5} sx={{ color, position: 'absolute', left: 0 }} />
            <Box sx={{ inset: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <Typography variant='h4' fontWeight={800} sx={{ color, lineHeight: 1 }} data-testid='zero-trust-score'>{total ?? '-'}</Typography>
              <Typography variant='caption' color='text.secondary'>/100</Typography>
            </Box>
          </Box>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          <Stack direction='row' alignItems='center' spacing={1.5} sx={{ mb: 1, flexWrap: 'wrap' }} useFlexGap>
            <Typography variant='h6' fontWeight={700}>{t('zeroTrustScore')}</Typography>
            <Chip
              size='small'
              data-testid='zero-trust-band'
              label={band ? t(BAND_LABEL[band]) : t('dashboard.scoreNotComputed')}
              sx={{ fontWeight: 700, bgcolor: alpha(color, 0.18), color: band ? color : 'text.secondary' }}
            />
          </Stack>
          {total === null && (
            <Typography variant='caption' color='text.secondary' component='div' sx={{ mb: 1 }}>{t('dashboard.scoreNotComputedHint')}</Typography>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1 }}>
            {score.components.map(c => {
              const scored = phase === 'ready' && c.points !== null
              return (
                <Box key={c.key} data-testid={`score-${c.key}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <Tooltip title={line(c)}>
                    <Typography variant='body2' noWrap sx={{ flex: 1, minWidth: 0 }}>
                      {t(`dashboard.${COMPONENT_LABEL[c.key]}`)}{values[c.key] ? ` · ${values[c.key]}` : ''}
                    </Typography>
                  </Tooltip>
                  <Chip
                    size='small'
                    label={scored ? `${c.points}/${c.weight}` : `-/${c.weight}`}
                    sx={{ height: 22, minWidth: 52, fontWeight: 700, fontSize: 11, bgcolor: alpha(scored && c.points ? STATE_GREEN : '#888', 0.18) }}
                  />
                </Box>
              )
            })}
          </Box>
        </Box>
      </Stack>
    </Paper>
  )
}
