'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
  alpha,
} from '@mui/material'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { formatBytes } from '@/utils/format'

const CustomTooltip = ({ active, payload, label, t, mode }) => {
  if (!active || !payload?.length) return null

  return (
    <Box sx={{
      bgcolor: 'background.paper',
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 1.5,
      px: 1.5,
      py: 1,
      boxShadow: 2,
    }}>
      <Typography variant='caption' sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
        {new Date(label + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
      </Typography>
      {mode === 'count' && payload.map((p, i) => (
        <Typography key={i} variant='caption' sx={{ display: 'block', color: p.color }}>
          {p.name}: {p.value}
        </Typography>
      ))}
      {mode === 'size' && payload.map((p, i) => (
        <Typography key={i} variant='caption' sx={{ display: 'block', color: p.color }}>
          {p.name}: {formatBytes(p.value)}
        </Typography>
      ))}
      {mode === 'verified' && payload.map((p, i) => (
        <Typography key={i} variant='caption' sx={{ display: 'block', color: p.color }}>
          {p.name}: {p.value}
        </Typography>
      ))}
    </Box>
  )
}

export default function BackupTrendsChart({ pbsId }) {
  const t = useTranslations()
  const theme = useTheme()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('count') // count | size | verified
  const [days, setDays] = useState(30)

  useEffect(() => {
    if (!pbsId) return

    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/v1/pbs/${encodeURIComponent(pbsId)}/backups/trends?days=${days}`)
        if (res.ok) {
          const json = await res.json()
          setData(json.data)
        }
      } catch (e) {
        console.error('Failed to load backup trends:', e)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [pbsId, days])

  const chartData = useMemo(() => {
    if (!data?.daily) return []
    return data.daily.map(d => ({
      ...d,
      dateLabel: new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    }))
  }, [data])

  const pieData = useMemo(() => {
    if (!data?.typeDistribution) return []
    const d = data.typeDistribution
    return [
      { name: 'VM', value: d.vm },
      { name: 'CT', value: d.ct },
    ].filter(x => x.value > 0)
  }, [data])

  const PIE_COLORS = [
    theme.palette.primary.main,
    theme.palette.secondary.main,
  ]

  if (!pbsId) return null

  return (
    <Card variant='outlined'>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-line-chart-line' style={{ fontSize: 20, color: theme.palette.primary.main }} />
            <Typography variant='subtitle1' fontWeight={700}>{t('backups.trendsTitle')}</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <ToggleButtonGroup size='small' value={mode} exclusive onChange={(_, v) => v && setMode(v)}>
              <ToggleButton value='count' sx={{ textTransform: 'none', fontSize: 11, px: 1.5 }}>
                {t('backups.trendsCount')}
              </ToggleButton>
              <ToggleButton value='size' sx={{ textTransform: 'none', fontSize: 11, px: 1.5 }}>
                {t('backups.trendsSize')}
              </ToggleButton>
              <ToggleButton value='verified' sx={{ textTransform: 'none', fontSize: 11, px: 1.5 }}>
                {t('backups.trendsVerification')}
              </ToggleButton>
            </ToggleButtonGroup>
            <ToggleButtonGroup size='small' value={days} exclusive onChange={(_, v) => v && setDays(v)}>
              <ToggleButton value={7} sx={{ textTransform: 'none', fontSize: 11, px: 1 }}>7d</ToggleButton>
              <ToggleButton value={14} sx={{ textTransform: 'none', fontSize: 11, px: 1 }}>14d</ToggleButton>
              <ToggleButton value={30} sx={{ textTransform: 'none', fontSize: 11, px: 1 }}>30d</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {!loading && data && (
          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
            {/* Main chart */}
            <Box sx={{ flex: 1, height: 280 }}>
              <ResponsiveContainer width='100%' height='100%'>
                {mode === 'count' ? (
                  <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray='3 3' stroke={alpha(theme.palette.divider, 0.4)} />
                    <XAxis
                      dataKey='date'
                      tick={{ fontSize: 10, fill: theme.palette.text.secondary }}
                      tickFormatter={v => new Date(v + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      interval={Math.max(0, Math.floor(chartData.length / 8) - 1)}
                    />
                    <YAxis tick={{ fontSize: 10, fill: theme.palette.text.secondary }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip t={t} mode='count' />} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey='vm' name='VM' stackId='a' fill={theme.palette.primary.main} radius={[0, 0, 0, 0]} />
                    <Bar dataKey='ct' name='CT' stackId='a' fill={theme.palette.secondary.main} radius={[2, 2, 0, 0]} />
                  </BarChart>
                ) : mode === 'size' ? (
                  <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id='sizeGrad' x1='0' y1='0' x2='0' y2='1'>
                        <stop offset='5%' stopColor={theme.palette.info.main} stopOpacity={0.3} />
                        <stop offset='95%' stopColor={theme.palette.info.main} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray='3 3' stroke={alpha(theme.palette.divider, 0.4)} />
                    <XAxis
                      dataKey='date'
                      tick={{ fontSize: 10, fill: theme.palette.text.secondary }}
                      tickFormatter={v => new Date(v + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      interval={Math.max(0, Math.floor(chartData.length / 8) - 1)}
                    />
                    <YAxis tick={{ fontSize: 10, fill: theme.palette.text.secondary }} tickFormatter={v => formatBytes(v)} />
                    <Tooltip content={<CustomTooltip t={t} mode='size' />} />
                    <Area
                      type='monotone'
                      dataKey='size'
                      name={t('backups.trendsSize')}
                      stroke={theme.palette.info.main}
                      fill='url(#sizeGrad)'
                      strokeWidth={2}
                    />
                  </AreaChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray='3 3' stroke={alpha(theme.palette.divider, 0.4)} />
                    <XAxis
                      dataKey='date'
                      tick={{ fontSize: 10, fill: theme.palette.text.secondary }}
                      tickFormatter={v => new Date(v + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      interval={Math.max(0, Math.floor(chartData.length / 8) - 1)}
                    />
                    <YAxis tick={{ fontSize: 10, fill: theme.palette.text.secondary }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip t={t} mode='verified' />} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey='verified' name={t('backups.verified')} stackId='a' fill={theme.palette.success.main} radius={[0, 0, 0, 0]} />
                    <Bar dataKey='unverified' name={t('backups.notVerified')} stackId='a' fill={alpha(theme.palette.text.disabled, 0.3)} radius={[2, 2, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </Box>

            {/* Pie chart */}
            {pieData.length > 0 && (
              <Box sx={{ width: { xs: '100%', md: 200 }, height: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant='caption' fontWeight={700} sx={{ opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5, mb: 1 }}>
                  {t('backups.trendsDistribution')}
                </Typography>
                <ResponsiveContainer width='100%' height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey='value'
                      nameKey='name'
                      cx='50%'
                      cy='50%'
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [`${value} (${data?.totalBackups ? Math.round(value / data.totalBackups * 100) : 0}%)`, name]}
                      contentStyle={{
                        backgroundColor: theme.palette.background.paper,
                        border: `1px solid ${theme.palette.divider}`,
                        borderRadius: 6,
                        fontSize: 11,
                      }}
                    />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Box>
        )}

        {!loading && !data && (
          <Typography variant='body2' sx={{ opacity: 0.5, textAlign: 'center', py: 4 }}>
            {t('common.noData')}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}
