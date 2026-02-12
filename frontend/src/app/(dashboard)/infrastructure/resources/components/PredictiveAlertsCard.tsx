'use client'

import {
  Box,
  Card,
  CardContent,
  Chip,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import type { PredictiveAlert } from '../types'
import { COLORS } from '../constants'
import { formatPct } from '../helpers'
import {
  SpeedIcon, MemoryIcon, StorageIcon, CloudIcon,
  AccessTimeIcon, TrendingUpIcon, TrendingDownIcon, TrendingFlatIcon,
  CheckCircleIcon,
} from './icons'

export default function PredictiveAlertsCard({ alerts, loading }: { alerts: PredictiveAlert[]; loading?: boolean }) {
  const t = useTranslations()

  const getResourceIcon = (resource: string) => {
    switch (resource) {
      case 'cpu': return <SpeedIcon sx={{ fontSize: 20 }} />
      case 'ram': return <MemoryIcon sx={{ fontSize: 20 }} />
      case 'storage': return <StorageIcon sx={{ fontSize: 20 }} />
      default: return <CloudIcon sx={{ fontSize: 20 }} />
    }
  }

  const getResourceLabel = (resource: string) => {
    switch (resource) {
      case 'cpu': return 'CPU'
      case 'ram': return t('monitoring.memory')
      case 'storage': return t('storage.title')
      default: return resource
    }
  }

  const getResourceColor = (resource: string) => {
    switch (resource) {
      case 'cpu': return COLORS.cpu
      case 'ram': return COLORS.ram
      case 'storage': return COLORS.storage
      default: return COLORS.info
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return COLORS.error
      case 'warning': return COLORS.warning
      default: return COLORS.success
    }
  }

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <TrendingUpIcon sx={{ fontSize: 16 }} />
      case 'down': return <TrendingDownIcon sx={{ fontSize: 16 }} />
      default: return <TrendingFlatIcon sx={{ fontSize: 16 }} />
    }
  }

  const getTrendTypeLabel = (trendType?: string) => {
    switch (trendType) {
      case 'accelerating': return `📈 ${t('resources.accelerating')}`
      case 'decelerating': return `📉 ${t('resources.decelerating')}`
      case 'linear': return `📊 ${t('resources.linear')}`
      case 'stable': return `➡️ ${t('resources.stable')}`
      default: return null
    }
  }

  if (loading) {
    return (
      <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Skeleton variant="text" width="50%" height={32} sx={{ mb: 2 }} />
          <Stack spacing={1.5} sx={{ flex: 1 }}>
            {[1, 2, 3].map(i => <Skeleton key={i} variant="rectangular" sx={{ flex: 1, minHeight: 70, borderRadius: 2 }} />)}
          </Stack>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2.5 }}>
          <AccessTimeIcon sx={{ color: COLORS.primary }} />
          <Typography variant="h6" fontWeight={700}>{t('resources.capacityForecasts')}</Typography>
          <Chip size="small" label={t('resources.polynomialRegression')} sx={{ ml: 'auto', height: 20, fontSize: '0.6rem', bgcolor: alpha(COLORS.primary, 0.1), color: COLORS.primary }} />
        </Stack>
        <Stack spacing={1.5} sx={{ flex: 1 }}>
          {alerts.map(alert => {
            const resourceColor = getResourceColor(alert.resource)
            const severityColor = getSeverityColor(alert.severity)
            const trendTypeLabel = getTrendTypeLabel(alert.trendType)

            return (
              <Paper key={alert.resource} sx={{ flex: 1, p: 2, bgcolor: alpha(severityColor, 0.04), border: '1px solid', borderColor: alpha(severityColor, 0.2), borderRadius: 2, '&:hover': { bgcolor: alpha(severityColor, 0.08) }, display: 'flex', alignItems: 'center' }}>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
                  <Box sx={{ p: 1, borderRadius: 1.5, bgcolor: alpha(resourceColor, 0.1), color: resourceColor, display: 'flex' }}>{getResourceIcon(alert.resource)}</Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                      <Typography variant="subtitle2" fontWeight={700}>{getResourceLabel(alert.resource)}</Typography>
                      <Chip size="small" icon={getTrendIcon(alert.trend)} label={`${alert.trend === 'up' ? '+' : alert.trend === 'down' ? '-' : ''}${Math.abs(alert.predictedValue - alert.currentValue).toFixed(1)}%`} sx={{ height: 20, fontSize: '0.7rem', bgcolor: alpha(alert.trend === 'up' ? COLORS.warning : alert.trend === 'down' ? COLORS.success : COLORS.info, 0.1), color: alert.trend === 'up' ? COLORS.warning : alert.trend === 'down' ? COLORS.success : COLORS.info, '& .MuiChip-icon': { fontSize: 14 } }} />
                      {trendTypeLabel && (
                        <Typography variant="caption" sx={{ opacity: 0.6, fontSize: '0.65rem' }}>{trendTypeLabel}</Typography>
                      )}
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="body2" color="text.secondary">
                        {formatPct(alert.currentValue)} → {formatPct(alert.predictedValue)}
                        <Typography component="span" variant="caption" sx={{ opacity: 0.7 }}> (30j)</Typography>
                      </Typography>
                      {alert.confidence !== undefined && (
                        <Chip
                          size="small"
                          label={`${Math.round(alert.confidence)}% conf.`}
                          sx={{
                            height: 16,
                            fontSize: '0.55rem',
                            bgcolor: alpha(alert.confidence > 70 ? COLORS.success : alert.confidence > 40 ? COLORS.warning : COLORS.error, 0.1),
                            color: alert.confidence > 70 ? COLORS.success : alert.confidence > 40 ? COLORS.warning : COLORS.error,
                          }}
                        />
                      )}
                    </Stack>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    {alert.daysToThreshold ? (
                      <>
                        <Typography variant="h6" fontWeight={700} sx={{ color: severityColor, lineHeight: 1 }}>{alert.daysToThreshold}j</Typography>
                        <Typography variant="caption" color="text.secondary">{t('resources.before')} {alert.threshold}%</Typography>
                      </>
                    ) : (
                      <>
                        <CheckCircleIcon sx={{ color: COLORS.success, fontSize: 24 }} />
                        <Typography variant="caption" color="text.secondary" display="block">OK</Typography>
                      </>
                    )}
                  </Box>
                </Stack>
              </Paper>
            )
          })}
        </Stack>
      </CardContent>
    </Card>
  )
}
