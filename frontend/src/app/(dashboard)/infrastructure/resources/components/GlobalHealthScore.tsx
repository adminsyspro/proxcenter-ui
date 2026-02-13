'use client'

import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Skeleton,
  Stack,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import type { KpiData, PredictiveAlert } from '../types'
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
  if (s >= 40) return 'À surveiller'
  return 'Critique'
}

function getScoreIcon(s: number) {
  if (s >= 80) return <ShieldIcon sx={{ fontSize: 32 }} />
  if (s >= 60) return <CheckCircleIcon sx={{ fontSize: 32 }} />
  if (s >= 40) return <WarningAmberIcon sx={{ fontSize: 32 }} />
  return <ErrorIcon sx={{ fontSize: 32 }} />
}

export default function GlobalHealthScore({
  score,
  kpis,
  alerts,
  loading,
}: {
  score: number
  kpis: KpiData | null
  alerts: PredictiveAlert[]
  loading?: boolean
}) {
  const theme = useTheme()
  const t = useTranslations()

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
      </CardContent>
    </Card>
  )
}
