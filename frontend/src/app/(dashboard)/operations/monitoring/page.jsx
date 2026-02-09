'use client'

import { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'

import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import Box from '@mui/material/Box'

import { DataGrid } from '@mui/x-data-grid'

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts'

import { monitoringApi } from '@/lib/api/monitoring'

// Recharts (déjà dans tes deps)
import { usePageTitle } from '@/contexts/PageTitleContext'

function MiniStat({ title, value, unit, subtitle }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          {title}
        </Typography>

        <Typography variant="h4" sx={{ mt: 0.5 }}>
          {typeof value === 'number' ? value : value ?? '-'}
          {unit ? (
            <Typography component="span" variant="h6" sx={{ ml: 0.5 }}>
              {unit}
            </Typography>
          ) : null}
        </Typography>

        {subtitle ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  )
}

function HealthBar({ score, t }) {
  const pct = typeof score === 'number' ? score : 0

  const labelKey =
    pct >= 90 ? 'monitoringPage.healthExcellent' : pct >= 75 ? 'monitoringPage.healthGood' : pct >= 55 ? 'monitoringPage.healthWatch' : 'monitoringPage.healthCritical'

  const label = t(labelKey)

  const color =
    pct >= 90 ? 'success' : pct >= 75 ? 'primary' : pct >= 55 ? 'warning' : 'error'

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle2">{t('monitoringPage.overallHealth')}</Typography>
        <Chip size="small" label={`${pct}/100 • ${label}`} color={color} />
      </Stack>
      <LinearProgress variant="determinate" value={pct} />
    </Stack>
  )
}

function formatHour(iso) {
  try {
    const d = new Date(iso)

    
return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export default function Page() {
  const t = useTranslations()
  const [loading, setLoading] = useState(true)
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('monitoring.title'), t('monitoringPage.subtitle'), 'ri-pulse-line')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const refreshMs = 10_000

  async function load() {
    try {
      setError('')
      const res = await monitoringApi.summary()

      // Normalisation (suivant ton wrapper api.get())
      // - parfois res.data = { data: ... }
      // - parfois res.data.data = ...
      const p = res?.data?.data ?? res?.data ?? null

      setPayload(p)
    } catch (e) {
      setError(e?.message || t('monitoringPage.unknownError'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const intervalId = setInterval(load, refreshMs)


return () => clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Compat schéma : overview OU kpis
  const overview = payload?.overview ?? payload?.kpis ?? payload?.data?.overview ?? payload?.data?.kpis ?? {}
  const series = payload?.series ?? payload?.data?.series ?? []
  const hotspots = payload?.hotspots ?? payload?.data?.hotspots ?? []

  const healthScore =
    payload?.healthScore ??
    payload?.data?.healthScore ??
    overview?.healthScore ??
    0

  const charts = useMemo(() => {
    return (series || []).map(p => ({
      ...p,
      hour: formatHour(p.ts)
    }))
  }, [series])

  const hotspotColumns = useMemo(
    () => [
      { field: 'type', headerName: t('common.type'), flex: 0.8, minWidth: 110 },
      { field: 'name', headerName: t('common.name'), flex: 1.2, minWidth: 160 },
      { field: 'metric', headerName: t('monitoringPage.metric'), flex: 0.9, minWidth: 130 },
      { field: 'value', headerName: t('monitoringPage.value'), flex: 0.8, minWidth: 120 },
      {
        field: 'trend',
        headerName: t('monitoringPage.trend'),
        flex: 0.7,
        minWidth: 120,
        renderCell: params => {
          const v = params.value
          const label = v === 'up' ? '↗' : v === 'down' ? '↘' : '→'


return <Chip size="small" variant="outlined" label={label} />
        }
      }
    ],
    [t]
  )

  return (
    <Stack spacing={4}>
      {error ? (
        <Card sx={{ border: '1px solid', borderColor: 'error.main', backgroundColor: 'error.lighter' }}>
          <CardContent>
            <Typography color="error.main">{error}</Typography>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent>
          <HealthBar score={healthScore} t={t} />
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={3}>
          <MiniStat title={t('monitoring.cpu')} value={overview.cpuUsagePct ?? 0} unit="%" subtitle={t('monitoringPage.globalUsage')} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MiniStat title={t('monitoringPage.ram')} value={overview.ramUsagePct ?? 0} unit="%" subtitle={t('monitoringPage.globalUsage')} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MiniStat title={t('monitoringPage.latency')} value={overview.latencyMs ?? 0} unit="ms" subtitle={t('monitoringPage.clusterAverage')} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <MiniStat title={t('monitoringPage.refresh')} value={Math.round(refreshMs / 1000)} unit="s" subtitle={loading ? t('common.loading') : t('monitoringPage.auto')} />
        </Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h5">{t('monitoringPage.trends24h')}</Typography>
          <Divider sx={{ my: 2 }} />

          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('monitoring.cpu')} (%)
              </Typography>
              <Box sx={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={charts}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="cpu" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </Grid>

            <Grid item xs={12} md={4}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('monitoringPage.ram')} (%)
              </Typography>
              <Box sx={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={charts}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="ram" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </Grid>

            <Grid item xs={12} md={4}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('monitoringPage.latency')} (ms)
              </Typography>
              <Box sx={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={charts}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="latencyMs" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h5">{t('monitoringPage.hotspots')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('monitoringPage.hotspotsDescription')}
          </Typography>

          <Divider sx={{ my: 2 }} />

          <div style={{ height: 440, width: '100%' }}>
            <DataGrid
              rows={hotspots}
              columns={hotspotColumns}
              loading={loading}
              disableRowSelectionOnClick
              pageSizeOptions={[10, 25, 50]}
              initialState={{
                pagination: { paginationModel: { pageSize: 10, page: 0 } }
              }}
            />
          </div>
        </CardContent>
      </Card>
    </Stack>
  )
}

