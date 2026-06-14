'use client'

import { useEffect, useState } from 'react'

import {
  Box,
  Card,
  CardContent,
  Skeleton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import { useTranslations } from 'next-intl'

interface Props {
  connId: string
  node: string
  type: 'qemu' | 'lxc'
  vmid: string | number
  days?: number
  inline?: boolean
}

interface GreenResponse {
  hasEnoughData: boolean
  windowDays: number
  samples: {
    count: number
    fromTs: number
    toTs: number
    avgCpuPct: number
    avgMemPct: number
    runningRatio: number
  }
  metrics: {
    power: { current: number; max: number; monthly: number; yearly: number }
    co2: {
      hourly: number; daily: number; monthly: number; yearly: number
      factor: number; equivalentKmCar: number; equivalentTrees: number
    }
    cost: {
      hourly: number; daily: number; monthly: number; yearly: number
      pricePerKwh: number; currency: string
    }
    efficiency: { pue: number; vmPerKw: number; score: number }
  } | null
  insight: {
    kind: string
    severity: 'warning' | 'info' | 'success'
    titleKey: string
    suggestionKey: string
    placeholders: Record<string, string | number>
  } | null
}

function scoreToGrade(score: number): string {
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 55) return 'C'
  if (score >= 40) return 'D'
  return 'E'
}

function cpuDelta(avgCpuPct: number): number {
  if (avgCpuPct < 10) return -20
  if (avgCpuPct < 20) return -10
  if (avgCpuPct < 30) return -5
  return 0
}

function pueDelta(pue: number): number {
  if (pue > 1.8) return -15
  if (pue > 1.5) return -10
  if (pue > 1.3) return -5
  if (pue <= 1.2) return +5
  return 0
}

function fmtDelta(n: number): string {
  if (n > 0) return `+${n}`
  if (n < 0) return `${n}`
  return '0'
}

const GRADE_COLORS: Record<string, string> = {
  A: '#22c55e',
  B: '#84cc16',
  C: '#eab308',
  D: '#f97316',
  E: '#ef4444',
}

export default function GreenScoreCard({ connId, node, type, vmid, days = 30, inline = false }: Props) {
  const t = useTranslations()
  const theme = useTheme()
  const [data, setData] = useState<GreenResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({ days: String(days) })
    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/${encodeURIComponent(type)}/${encodeURIComponent(node)}/${encodeURIComponent(String(vmid))}/green?${qs}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((json: GreenResponse) => { if (!cancelled) setData(json) })
      .catch((e) => { if (!cancelled) setError(e?.message || 'fetch error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [connId, node, type, vmid, days])

  if (loading) {
    if (inline) {
      return <Skeleton variant="rectangular" width={260} height={20} sx={{ borderRadius: 1, flexShrink: 0 }} />
    }
    return (
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5 }}>
          <Skeleton variant="rectangular" height={64} />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    // Card is informational, swallow errors silently.
    return null
  }

  if (!data) return null

  if (!data.hasEnoughData) {
    if (inline) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0, opacity: 0.7 }}>
          <Box component="i" className="ri-leaf-line" sx={{ fontSize: 16, color: 'success.main' }} />
          <Typography component="span" variant="caption" noWrap>
            {t('green.score.title')} · {t('green.score.notEnoughData')}
          </Typography>
        </Box>
      )
    }
    return (
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box component="i" className="ri-leaf-line" sx={{ fontSize: 18, color: 'success.main' }} />
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            {t('green.score.title')} · {t('green.score.notEnoughData')}
          </Typography>
        </CardContent>
      </Card>
    )
  }

  const { metrics, insight } = data
  if (!metrics) return null

  const grade = scoreToGrade(metrics.efficiency.score)
  const gradeColor = GRADE_COLORS[grade]
  const sevColor =
    insight?.severity === 'warning' ? theme.palette.warning.main :
    insight?.severity === 'success' ? theme.palette.success.main :
    theme.palette.info.main
  const sevIcon =
    insight?.severity === 'warning' ? 'ri-error-warning-line' :
    insight?.severity === 'success' ? 'ri-leaf-line' :
    'ri-information-line'

  const currencySymbol = metrics.cost.currency === 'EUR' ? '€' : metrics.cost.currency
  const fmtMoney = `${metrics.cost.monthly.toLocaleString()} ${currencySymbol}`

  const suggestion = insight && insight.suggestionKey ? t(insight.suggestionKey, insight.placeholders) : ''

  const avgCpu = data?.samples?.avgCpuPct ?? 0
  const pue = metrics.efficiency.pue
  const dCpu = cpuDelta(avgCpu)
  const dPue = pueDelta(pue)
  const runningPct = Math.round((data?.samples?.runningRatio ?? 0) * 100)

  const tooltipContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: 0.5, minWidth: 240 }}>
      <Typography variant="caption" component="div" sx={{ fontWeight: 700 }}>
        {t('green.score.title')} · {metrics.efficiency.score}/100 · {t('green.score.window')}
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, opacity: 0.95 }}>
        <Typography variant="caption" component="div">{metrics.power.monthly} kWh · {t('green.score.energy')}</Typography>
        <Typography variant="caption" component="div">{fmtMoney} · {t('green.score.cost')}</Typography>
        <Typography variant="caption" component="div">{metrics.co2.monthly} kg CO₂ · {t('green.score.emissions')}</Typography>
      </Box>

      <Box sx={{ pt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" component="div" sx={{ fontWeight: 700, mb: 0.5 }}>
          {t('green.score.breakdownTitle')}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 1, rowGap: 0.25 }}>
          <Typography variant="caption" component="span">{t('green.score.breakdownBase')}</Typography>
          <Typography variant="caption" component="span" sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>100</Typography>

          <Typography variant="caption" component="span">{t('green.score.breakdownCpu', { cpu: Math.round(avgCpu) })}</Typography>
          <Typography variant="caption" component="span" sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: dCpu < 0 ? 'warning.main' : 'text.primary' }}>{fmtDelta(dCpu)}</Typography>

          <Typography variant="caption" component="span">{t('green.score.breakdownPue', { pue: pue.toFixed(2) })}</Typography>
          <Typography variant="caption" component="span" sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: dPue < 0 ? 'warning.main' : dPue > 0 ? 'success.main' : 'text.primary' }}>{fmtDelta(dPue)}</Typography>

          <Typography variant="caption" component="span" sx={{ fontWeight: 700, borderTop: '1px solid', borderColor: 'divider', pt: 0.25 }}>{t('green.score.breakdownTotal')}</Typography>
          <Typography variant="caption" component="span" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right', borderTop: '1px solid', borderColor: 'divider', pt: 0.25 }}>{metrics.efficiency.score}/100</Typography>
        </Box>
        <Typography variant="caption" component="div" sx={{ opacity: 0.7, mt: 0.5 }}>
          {t('green.score.breakdownRuntime', { pct: runningPct })}
        </Typography>
      </Box>

      {insight && (
        <Box sx={{ pt: 0.5, borderTop: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
          <Box component="i" className={sevIcon} sx={{ fontSize: 14, color: sevColor, mt: '2px', flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" component="div" sx={{ fontWeight: 700 }}>
              {t(insight.titleKey, insight.placeholders)}
            </Typography>
            {suggestion ? (
              <Typography variant="caption" component="div" sx={{ opacity: 0.85 }}>
                {suggestion}
              </Typography>
            ) : null}
          </Box>
        </Box>
      )}
    </Box>
  )

  const content = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'nowrap', minWidth: 0 }}>
      <Tooltip
        title={tooltipContent}
        arrow
        placement="bottom-start"
        slotProps={{
          tooltip: {
            sx: {
              bgcolor: 'background.paper',
              color: 'text.primary',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1.5,
              boxShadow: 3,
              px: 1.25,
              py: 1,
              maxWidth: 320,
            },
          },
          arrow: { sx: { color: 'background.paper', '&::before': { border: '1px solid', borderColor: 'divider' } } },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, cursor: 'help' }}>
          <Box component="i" className="ri-leaf-line" sx={{ fontSize: inline ? 16 : 18, color: 'success.main' }} />
          <Typography component="span" variant={inline ? 'subtitle2' : 'h6'} sx={{ fontWeight: 800, color: gradeColor, lineHeight: 1 }}>
            {grade}
          </Typography>
        </Box>
      </Tooltip>
    </Box>
  )

  if (inline) return content

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
        {content}
      </CardContent>
    </Card>
  )
}
