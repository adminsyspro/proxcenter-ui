'use client'

import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Paper,
  Skeleton,
  Stack,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import type { GreenMetrics } from '../types'
import { COLORS } from '../constants'
import {
  EnergySavingsLeafIcon, ElectricBoltIcon, Co2Icon, ParkIcon,
  DirectionsCarIcon, EuroIcon, BoltIcon, CloudIcon,
} from './icons'

export default function GreenMetricsCard({ green, loading }: { green: GreenMetrics | null; loading?: boolean }) {
  const theme = useTheme()
  const t = useTranslations()

  if (loading || !green) {
    return (
      <Card sx={{ background: `linear-gradient(135deg, ${alpha('#22c55e', 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.98)} 100%)`, border: '1px solid', borderColor: alpha('#22c55e', 0.2) }}>
        <CardContent sx={{ p: 3 }}>
          <Skeleton variant="text" width="40%" height={32} sx={{ mb: 2 }} />
          <Stack direction="row" spacing={2}>
            {[1, 2, 3, 4].map(i => <Skeleton key={i} variant="rectangular" width="25%" height={120} sx={{ borderRadius: 2 }} />)}
          </Stack>
        </CardContent>
      </Card>
    )
  }

  const greenColor = '#22c55e'
  const scoreColor = green.efficiency.score >= 70 ? greenColor : green.efficiency.score >= 50 ? COLORS.warning : COLORS.error

  return (
    <Card sx={{ background: `linear-gradient(135deg, ${alpha(greenColor, 0.05)} 0%, ${alpha(theme.palette.background.paper, 0.98)} 50%, ${alpha(greenColor, 0.02)} 100%)`, border: '1px solid', borderColor: alpha(greenColor, 0.25), overflow: 'hidden', position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: -30, right: -30, width: 150, height: 150, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(greenColor, 0.08)} 0%, transparent 70%)`, pointerEvents: 'none' }} />
      <CardContent sx={{ p: 3, position: 'relative' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ p: 1, borderRadius: 2, bgcolor: alpha(greenColor, 0.1), color: greenColor, display: 'flex' }}><EnergySavingsLeafIcon /></Box>
            <Box>
              <Typography variant="h6" fontWeight={700}>{t('resources.environmentalImpact')}</Typography>
              <Typography variant="caption" color="text.secondary">{t('resources.estimationsBasedOnInfra')}</Typography>
            </Box>
          </Stack>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              <CircularProgress variant="determinate" value={100} size={56} thickness={4} sx={{ color: alpha(scoreColor, 0.15) }} />
              <CircularProgress variant="determinate" value={green.efficiency.score} size={56} thickness={4} sx={{ color: scoreColor, position: 'absolute', left: 0 }} />
              <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant="body2" fontWeight={800} sx={{ color: scoreColor }}>{green.efficiency.score}</Typography>
              </Box>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>{t('resources.greenScoreLabel')}</Typography>
              <Typography variant="caption" fontWeight={700} sx={{ color: scoreColor }}>{t('resources.greenLabel')}</Typography>
            </Box>
          </Stack>
        </Stack>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Paper sx={{ flex: 1, p: 2, bgcolor: alpha(COLORS.warning, 0.04), border: '1px solid', borderColor: alpha(COLORS.warning, 0.15), borderRadius: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <ElectricBoltIcon sx={{ fontSize: 18, color: COLORS.warning }} />
              <Typography variant="caption" fontWeight={600} color="text.secondary">{t('resources.consumption')}</Typography>
            </Stack>
            <Typography variant="h5" fontWeight={800} sx={{ color: COLORS.warning }}>{green.power.current.toLocaleString()} W</Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.monthly')}</Typography>
                <Typography variant="body2" fontWeight={600}>{green.power.monthly.toLocaleString()} kWh</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.yearly')}</Typography>
                <Typography variant="body2" fontWeight={600}>{green.power.yearly.toLocaleString()} kWh</Typography>
              </Box>
            </Stack>
          </Paper>

          <Paper sx={{ flex: 1, p: 2, bgcolor: alpha('#64748b', 0.04), border: '1px solid', borderColor: alpha('#64748b', 0.15), borderRadius: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Co2Icon sx={{ fontSize: 18, color: '#64748b' }} />
              <Typography variant="caption" fontWeight={600} color="text.secondary">{t('resources.co2Emissions')}</Typography>
            </Stack>
            <Typography variant="h5" fontWeight={800} sx={{ color: '#64748b' }}>{green.co2.yearly.toLocaleString()} kg/{t('resources.year')}</Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.perDay')}</Typography>
                <Typography variant="body2" fontWeight={600}>{green.co2.daily} kg</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.factor')}</Typography>
                <Typography variant="body2" fontWeight={600}>{green.co2.factor} kg/kWh</Typography>
              </Box>
            </Stack>
          </Paper>

          <Paper sx={{ flex: 1, p: 2, bgcolor: alpha(greenColor, 0.04), border: '1px solid', borderColor: alpha(greenColor, 0.15), borderRadius: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <ParkIcon sx={{ fontSize: 18, color: greenColor }} />
              <Typography variant="caption" fontWeight={600} color="text.secondary">{t('resources.equivalentsPerYear')}</Typography>
            </Stack>
            <Stack spacing={1}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <DirectionsCarIcon sx={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2"><strong>{green.co2.equivalentKmCar.toLocaleString()}</strong> {t('resources.kmByCar')}</Typography>
              </Stack>
              <Stack direction="row" alignItems="center" spacing={1}>
                <ParkIcon sx={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2"><strong>{green.co2.equivalentTrees}</strong> {t('resources.treesToCompensate')}</Typography>
              </Stack>
            </Stack>
          </Paper>

          <Paper sx={{ flex: 1, p: 2, bgcolor: alpha(COLORS.info, 0.04), border: '1px solid', borderColor: alpha(COLORS.info, 0.15), borderRadius: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <EuroIcon sx={{ fontSize: 18, color: COLORS.info }} />
              <Typography variant="caption" fontWeight={600} color="text.secondary">{t('resources.energyCost')}</Typography>
            </Stack>
            <Typography variant="h5" fontWeight={800} sx={{ color: COLORS.info }}>{green.cost.yearly.toLocaleString()} €/{t('resources.year')}</Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.monthly')}</Typography>
                <Typography variant="body2" fontWeight={600}>{green.cost.monthly} €</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.priceKwh')}</Typography>
                <Typography variant="body2" fontWeight={600}>{green.cost.pricePerKwh} €</Typography>
              </Box>
            </Stack>
          </Paper>
        </Stack>

        <Stack direction="row" spacing={3} sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Chip size="small" icon={<BoltIcon sx={{ fontSize: 14 }} />} label={`PUE: ${green.efficiency.pue}`} sx={{ bgcolor: alpha(COLORS.warning, 0.1), color: COLORS.warning }} />
          <Chip size="small" icon={<CloudIcon sx={{ fontSize: 14 }} />} label={`${green.efficiency.vmPerKw} VMs/kW`} sx={{ bgcolor: alpha(COLORS.info, 0.1), color: COLORS.info }} />
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>{t('resources.optimizeScore')}</Typography>
        </Stack>
      </CardContent>
    </Card>
  )
}
