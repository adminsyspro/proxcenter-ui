'use client'

import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  Cell,
} from 'recharts'

import type { StoragePool } from '../types'
import { COLORS } from '../constants'
import { StorageIcon } from './icons'

export default function StoragePerPoolCard({ pools, loading }: { pools: StoragePool[]; loading?: boolean }) {
  const t = useTranslations()

  if (!pools || pools.length === 0) return null

  const getPoolColor = (pct: number) => {
    if (pct >= 90) return COLORS.error
    if (pct >= 80) return COLORS.warning
    if (pct >= 60) return '#f97316'
    return COLORS.success
  }

  const chartData = pools.map(pool => ({
    name: pool.name,
    pct: Math.round(pool.pct * 10) / 10,
    type: pool.type,
    usedGB: Math.round(pool.used / (1024 * 1024 * 1024)),
    totalGB: Math.round(pool.total / (1024 * 1024 * 1024)),
  }))

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <StorageIcon sx={{ color: COLORS.storage, fontSize: 20 }} />
          <Typography variant="h6" fontWeight={700}>{t('resources.storageByPool')}</Typography>
          <Chip size="small" label={`${pools.length} pools`} sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(COLORS.storage, 0.1), color: COLORS.storage }} />
        </Stack>

        <Box sx={{ width: '100%', height: Math.max(150, pools.length * 40 + 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 80, right: 20 }}>
              <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
              <RTooltip
                formatter={(v: any, _: string, props: any) => {
                  const item = props.payload
                  return [`${v}% (${item.usedGB} / ${item.totalGB} GB)`, item.type]
                }}
              />
              <Bar dataKey="pct" radius={[0, 4, 4, 0]} barSize={20}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={getPoolColor(entry.pct)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
          {pools.filter(p => p.projectedFullDate).map(pool => (
            <Chip
              key={pool.name}
              size="small"
              label={`${pool.name}: ${t('resources.fullBy')} ${pool.projectedFullDate}`}
              sx={{ height: 22, fontSize: '0.65rem', bgcolor: alpha(COLORS.warning, 0.1), color: COLORS.warning }}
            />
          ))}
        </Stack>
      </CardContent>
    </Card>
  )
}
