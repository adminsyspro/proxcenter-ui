'use client'

import { useState } from 'react'
import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  LinearProgress,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import type { KpiData, PredictiveAlert } from '../types'
import type { HealthScoreBreakdown } from '../algorithms/healthScore'
import { COLORS } from '../constants'
import { formatPct } from '../helpers'
import {
  ShieldIcon, CheckCircleIcon, WarningAmberIcon, ErrorIcon,
} from './icons'

function getScoreColor(s: number) {
  if (s >= 80) return COLORS.success
  if (s >= 60) return COLORS.warning
  if (s >= 40) return '#f97316'
  return COLORS.error
}

function getScoreLabel(s: number) {
  if (s >= 80) return 'Excellent'
  if (s >= 60) return 'Bon'
  if (s >= 40) return 'A surveiller'
  return 'Critique'
}

function getScoreIcon(s: number) {
  if (s >= 80) return <ShieldIcon sx={{ fontSize: 32 }} />
  if (s >= 60) return <CheckCircleIcon sx={{ fontSize: 32 }} />
  if (s >= 40) return <WarningAmberIcon sx={{ fontSize: 32 }} />
  return <ErrorIcon sx={{ fontSize: 32 }} />
}

const BreakdownRow = ({ label, icon, penalty, reason, maxPenalty }: {
  label: string; icon: string; penalty: number; reason: string; maxPenalty: number
}) => {
  const isPositive = penalty > 0
  const isNeutral = penalty === 0
  const color = isPositive ? COLORS.success : isNeutral ? 'text.secondary' : penalty >= -5 ? COLORS.warning : COLORS.error

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75 }}>
      <Box sx={{ width: 24, textAlign: 'center', opacity: 0.6, fontSize: '0.85rem' }}>
        <i className={icon} />
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 80 }}>{label}</Typography>
      <Box sx={{ flex: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{reason}</Typography>
      </Box>
      <Chip
        size="small"
        label={isPositive ? `+${penalty}` : penalty === 0 ? '0' : `${penalty}`}
        sx={{
          height: 22, minWidth: 44, fontWeight: 700, fontSize: '0.75rem',
          bgcolor: alpha(typeof color === 'string' && color.startsWith('#') ? color : '#888', 0.12),
          color,
        }}
      />
    </Box>
  )
}

export default function GlobalHealthScore({
  score,
  kpis,
  alerts,
  breakdown,
  loading,
}: {
  score: number
  kpis: KpiData | null
  alerts: PredictiveAlert[]
  breakdown: HealthScoreBreakdown | null
  loading?: boolean
}) {
  const theme = useTheme()
  const t = useTranslations()
  const [showDetails, setShowDetails] = useState(false)

  const criticalAlerts = alerts.filter(a => a.severity === 'critical').length
  const warningAlerts = alerts.filter(a => a.severity === 'warning').length

  if (loading) {
    return (
      <Card sx={{ background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`, border: '1px solid', borderColor: 'divider' }}>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" spacing={4} alignItems="center">
            <Skeleton variant="circular" width={140} height={140} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="60%" height={40} />
              <Skeleton variant="text" width="80%" />
            </Box>
          </Stack>
        </CardContent>
      </Card>
    )
  }

  const color = getScoreColor(score)

  return (
    <Card sx={{
      background: `linear-gradient(135deg, ${alpha(color, 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.98)} 50%, ${alpha(color, 0.03)} 100%)`,
      border: '1px solid',
      borderColor: alpha(color, 0.3),
      position: 'relative',
      overflow: 'hidden',
      '&:hover': { borderColor: alpha(color, 0.5), boxShadow: `0 8px 32px ${alpha(color, 0.15)}` },
    }}>
      <Box sx={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(color, 0.1)} 0%, transparent 70%)` }} />
      <CardContent sx={{ p: 3, position: 'relative' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} alignItems="center">
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <CircularProgress variant="determinate" value={100} size={160} thickness={3} sx={{ color: alpha(color, 0.15) }} />
            <CircularProgress variant="determinate" value={score} size={160} thickness={3} sx={{ color, position: 'absolute', left: 0, filter: `drop-shadow(0 0 8px ${alpha(color, 0.4)})` }} />
            <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <Typography variant="h2" fontWeight={800} sx={{ color, lineHeight: 1 }}>{score}</Typography>
              <Typography variant="caption" color="text.secondary">/100</Typography>
            </Box>
          </Box>

          <Box sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
              <Box sx={{ color }}>{getScoreIcon(score)}</Box>
              <Typography variant="h4" fontWeight={700}>{t('resources.infrastructureHealth')}</Typography>
              {breakdown && (
                <Tooltip title={showDetails ? 'Hide details' : 'Show score breakdown'}>
                  <IconButton size="small" onClick={() => setShowDetails(!showDetails)} sx={{ ml: 0.5 }}>
                    <i className={showDetails ? 'ri-arrow-up-s-line' : 'ri-information-line'} style={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
            <Chip label={getScoreLabel(score)} sx={{ bgcolor: alpha(color, 0.15), color, fontWeight: 700, fontSize: '0.9rem', height: 32, mb: 2 }} />
            <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.activeVms')}</Typography>
                <Typography variant="h6" fontWeight={700}>{kpis?.vms.running || 0}<Typography component="span" variant="body2" color="text.secondary"> / {kpis?.vms.total || 0}</Typography></Typography>
              </Box>
              <Divider orientation="vertical" flexItem />
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.efficiency')}</Typography>
                <Typography variant="h6" fontWeight={700}>{kpis?.efficiency || 0}%</Typography>
              </Box>
              <Divider orientation="vertical" flexItem />
              <Box>
                <Typography variant="caption" color="text.secondary">Alertes</Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  {criticalAlerts > 0 && <Chip size="small" label={criticalAlerts} sx={{ bgcolor: alpha(COLORS.error, 0.15), color: COLORS.error, fontWeight: 700 }} />}
                  {warningAlerts > 0 && <Chip size="small" label={warningAlerts} sx={{ bgcolor: alpha(COLORS.warning, 0.15), color: COLORS.warning, fontWeight: 700 }} />}
                  {criticalAlerts === 0 && warningAlerts === 0 && <Typography variant="h6" fontWeight={700} sx={{ color: COLORS.success }}>0</Typography>}
                </Stack>
              </Box>
            </Stack>
          </Box>

          <Stack spacing={1.5} sx={{ minWidth: 200 }}>
            {[
              { label: 'CPU', value: kpis?.cpu.used || 0, color: COLORS.cpu },
              { label: 'RAM', value: kpis?.ram.used || 0, color: COLORS.ram },
              { label: t('resources.storageLabel'), value: kpis && kpis.storage.total > 0 ? (kpis.storage.used / kpis.storage.total) * 100 : 0, color: COLORS.storage },
            ].map(item => (
              <Box key={item.label}>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
                  <Typography variant="caption" color="text.secondary">{item.label}</Typography>
                  <Typography variant="caption" fontWeight={600}>{formatPct(item.value)}</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={Math.min(100, item.value)} sx={{ height: 14, borderRadius: 0, bgcolor: alpha(item.color, 0.1), '& .MuiLinearProgress-bar': { bgcolor: item.color, borderRadius: 0 } }} />
              </Box>
            ))}
          </Stack>
        </Stack>

        {/* Score Breakdown */}
        {breakdown && (
          <Collapse in={showDetails}>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              Score Breakdown
              <Typography component="span" variant="caption" sx={{ ml: 1, opacity: 0.6 }}>Base: 100 pts</Typography>
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 0.5 }}>
              <BreakdownRow label="CPU" icon="ri-cpu-line" penalty={breakdown.cpu.penalty} reason={breakdown.cpu.reason} maxPenalty={20} />
              <BreakdownRow label="RAM" icon="ri-database-2-line" penalty={breakdown.ram.penalty} reason={breakdown.ram.reason} maxPenalty={25} />
              <BreakdownRow label="Storage" icon="ri-hard-drive-3-line" penalty={breakdown.storage.penalty} reason={breakdown.storage.reason} maxPenalty={25} />
              <BreakdownRow label="Alertes" icon="ri-alarm-warning-line" penalty={breakdown.alerts.penalty} reason={breakdown.alerts.reason} maxPenalty={30} />
              <BreakdownRow label="Efficiency" icon="ri-speed-line" penalty={breakdown.efficiency.penalty} reason={breakdown.efficiency.reason} maxPenalty={15} />
              <BreakdownRow label="VMs off" icon="ri-shut-down-line" penalty={breakdown.stoppedVms.penalty} reason={breakdown.stoppedVms.reason} maxPenalty={10} />
            </Box>
          </Collapse>
        )}
      </CardContent>
    </Card>
  )
}
