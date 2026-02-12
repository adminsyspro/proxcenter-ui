'use client'

import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
} from 'recharts'

import type { NetworkMetrics } from '../types'
import { COLORS } from '../constants'
import { formatBytesPerSec } from '../helpers'
import { NetworkIcon } from './icons'

export default function NetworkIoCard({ metrics, loading }: { metrics: NetworkMetrics | null; loading?: boolean }) {
  const theme = useTheme()
  const t = useTranslations()

  if (!metrics || !metrics.trends?.length) return null

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <NetworkIcon sx={{ color: COLORS.network, fontSize: 20 }} />
          <Typography variant="h6" fontWeight={700}>{t('resources.networkIo')}</Typography>
          <Chip size="small" label={`In: ${formatBytesPerSec(metrics.totalIn)} / Out: ${formatBytesPerSec(metrics.totalOut)}`} sx={{ height: 22, fontSize: '0.65rem', bgcolor: alpha(COLORS.network, 0.1), color: COLORS.network }} />
        </Stack>

        <Box sx={{ width: '100%', height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={metrics.trends}>
              <defs>
                <linearGradient id="netInGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.info} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.info} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="netOutGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.network} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.network} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => formatBytesPerSec(v)} />
              <RTooltip
                contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 8 }}
                formatter={(v: any, name: string) => [formatBytesPerSec(v), name]}
              />
              <Area type="monotone" dataKey="netin" name="In" stroke={COLORS.info} fill="url(#netInGrad)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="netout" name="Out" stroke={COLORS.network} fill="url(#netOutGrad)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Box>
      </CardContent>
    </Card>
  )
}
