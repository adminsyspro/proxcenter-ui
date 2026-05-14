'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Box, Chip, CircularProgress, Paper, Skeleton, Stack, Typography, useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'

interface GreenData {
  power: { current: number; max: number; monthly: number; yearly: number }
  co2: {
    hourly: number; daily: number; monthly: number; yearly: number
    factor: number
    equivalentKmCar: number
    equivalentTrees: number
  }
  efficiency: { pue: number; vmPerKw: number; score: number }
}

interface ApiResponse {
  data: GreenData | null
  configured: boolean
  vmCount?: number
  runningVmCount?: number
}

interface Props {
  vdcId: string
}

const REFRESH_MS = 5 * 60_000
const greenColor = '#22c55e'
const warningColor = '#f59e0b'
const errorColor = '#ef4444'
const co2Color = '#64748b'

/**
 * Tenant-side Green-IT card: power, CO₂ and equivalences for the VMs the
 * tenant runs in this vDC. Pulls /api/v1/vdcs/[id]/green which uses the
 * provider's PUE / electricity / CO₂ configuration to keep numbers
 * comparable across tenants. No financial figures here — pricing is a
 * super-admin concern.
 */
export default function MyGreenCard({ vdcId }: Props) {
  const t = useTranslations()
  const theme = useTheme()
  const [resp, setResp] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const r = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/green`, { cache: 'no-store' })

        if (!r.ok) {
          if (!cancelled) setResp(null)

return
        }

        const json = await r.json()

        if (!cancelled) setResp(json)
      } catch {
        if (!cancelled) setResp(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const interval = setInterval(() => { void load() }, REFRESH_MS)


return () => { cancelled = true; clearInterval(interval) }
  }, [vdcId])

  if (loading) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Skeleton variant="text" width={180} height={28} />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 2 }}>
          {[0, 1, 2].map(i => <Skeleton key={i} variant="rounded" height={104} sx={{ flex: 1 }} />)}
        </Stack>
      </Paper>
    )
  }

  if (!resp || !resp.configured || !resp.data) {
    return (
      <Paper variant="outlined" sx={{ p: 2, background: `linear-gradient(135deg, ${alpha(greenColor, 0.04)} 0%, transparent 100%)` }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <i className="ri-leaf-line" style={{ color: greenColor }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {t('myVdc.cockpit.greenTitle')}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {t('myVdc.cockpit.greenNotConfigured')}
        </Typography>
      </Paper>
    )
  }

  const { power, co2, efficiency } = resp.data
  const scoreColor = efficiency.score >= 70 ? greenColor : efficiency.score >= 50 ? warningColor : errorColor

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        background: `linear-gradient(135deg, ${alpha(greenColor, 0.04)} 0%, ${alpha(theme.palette.background.paper, 0.98)} 50%, ${alpha(greenColor, 0.02)} 100%)`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ position: 'absolute', top: -30, right: -30, width: 150, height: 150, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(greenColor, 0.08)} 0%, transparent 70%)`, pointerEvents: 'none' }} />

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2, position: 'relative' }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box sx={{ p: 0.75, borderRadius: 1.5, bgcolor: alpha(greenColor, 0.1), color: greenColor, display: 'flex' }}>
            <i className="ri-leaf-line" style={{ fontSize: 20 }} />
          </Box>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>{t('myVdc.cockpit.greenTitle')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('myVdc.cockpit.greenSubtitle')}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <CircularProgress variant="determinate" value={100} size={48} thickness={4} sx={{ color: alpha(scoreColor, 0.15) }} />
            <CircularProgress variant="determinate" value={efficiency.score} size={48} thickness={4} sx={{ color: scoreColor, position: 'absolute', left: 0 }} />
            <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="caption" fontWeight={800} sx={{ color: scoreColor, fontSize: 13 }}>{efficiency.score}</Typography>
            </Box>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
              {t('myVdc.cockpit.greenScore')}
            </Typography>
            <Typography variant="caption" fontWeight={700} sx={{ color: scoreColor }}>
              {efficiency.score >= 70 ? t('myVdc.cockpit.greenLabel') : efficiency.score >= 50 ? t('myVdc.cockpit.greenLabelMid') : t('myVdc.cockpit.greenLabelLow')}
            </Typography>
          </Box>
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ position: 'relative' }}>
        <Paper variant="outlined" sx={{ flex: 1, p: 1.5, bgcolor: alpha(warningColor, 0.04), borderColor: alpha(warningColor, 0.2) }}>
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
            <i className="ri-flashlight-line" style={{ fontSize: 16, color: warningColor }} />
            <Typography variant="caption" fontWeight={600} color="text.secondary">
              {t('myVdc.cockpit.greenConsumption')}
            </Typography>
          </Stack>
          <Typography variant="h6" fontWeight={800} sx={{ color: warningColor, lineHeight: 1.1 }}>
            {power.current.toLocaleString()} W
          </Typography>
          <Stack direction="row" spacing={2} sx={{ mt: 0.75 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('myVdc.cockpit.greenMonthly')}</Typography>
              <Typography variant="body2" fontWeight={600}>{power.monthly.toLocaleString()} kWh</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('myVdc.cockpit.greenYearly')}</Typography>
              <Typography variant="body2" fontWeight={600}>{power.yearly.toLocaleString()} kWh</Typography>
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ flex: 1, p: 1.5, bgcolor: alpha(co2Color, 0.04), borderColor: alpha(co2Color, 0.2) }}>
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
            <i className="ri-cloud-line" style={{ fontSize: 16, color: co2Color }} />
            <Typography variant="caption" fontWeight={600} color="text.secondary">
              {t('myVdc.cockpit.greenCo2')}
            </Typography>
          </Stack>
          <Typography variant="h6" fontWeight={800} sx={{ color: co2Color, lineHeight: 1.1 }}>
            {co2.yearly.toLocaleString()} kg/{t('myVdc.cockpit.greenYear')}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ mt: 0.75 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('myVdc.cockpit.greenPerDay')}</Typography>
              <Typography variant="body2" fontWeight={600}>{co2.daily} kg</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('myVdc.cockpit.greenFactor')}</Typography>
              <Typography variant="body2" fontWeight={600}>{co2.factor} kg/kWh</Typography>
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ flex: 1, p: 1.5, bgcolor: alpha(greenColor, 0.04), borderColor: alpha(greenColor, 0.2) }}>
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.75 }}>
            <i className="ri-plant-line" style={{ fontSize: 16, color: greenColor }} />
            <Typography variant="caption" fontWeight={600} color="text.secondary">
              {t('myVdc.cockpit.greenEquivalents')}
            </Typography>
          </Stack>
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <i className="ri-car-line" style={{ fontSize: 14, opacity: 0.6 }} />
              <Typography variant="body2">
                <strong>{co2.equivalentKmCar.toLocaleString()}</strong> {t('myVdc.cockpit.greenKmCar')}
              </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <i className="ri-plant-fill" style={{ fontSize: 14, opacity: 0.6, color: greenColor }} />
              <Typography variant="body2">
                <strong>{co2.equivalentTrees}</strong> {t('myVdc.cockpit.greenTreesYear')}
              </Typography>
            </Stack>
          </Stack>
        </Paper>
      </Stack>

      <Stack direction="row" spacing={1.5} sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider', position: 'relative' }}>
        <Chip size="small" icon={<i className="ri-flashlight-fill" style={{ fontSize: 12 }} />} label={`PUE: ${efficiency.pue}`} sx={{ bgcolor: alpha(warningColor, 0.1), color: warningColor }} />
        <Chip size="small" icon={<i className="ri-server-line" style={{ fontSize: 12 }} />} label={`${efficiency.vmPerKw} ${t('myVdc.cockpit.greenVmsPerKw')}`} sx={{ bgcolor: alpha(co2Color, 0.1), color: co2Color }} />
      </Stack>
    </Paper>
  )
}
