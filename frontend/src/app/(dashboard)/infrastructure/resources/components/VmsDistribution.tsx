'use client'

import {
  Box,
  Card,
  CardContent,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RTooltip,
} from 'recharts'

import type { KpiData } from '../types'
import { COLORS } from '../constants'

export default function VmsDistribution({ kpis, loading }: { kpis: KpiData | null; loading?: boolean }) {
  const t = useTranslations()

  if (loading || !kpis) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Skeleton variant="circular" width={150} height={150} />
          <Skeleton variant="text" width="60%" sx={{ mt: 2 }} />
        </CardContent>
      </Card>
    )
  }

  const data = [
    { name: 'Running', value: kpis.vms.running, color: COLORS.success },
    { name: 'Stopped', value: kpis.vms.stopped, color: COLORS.error },
  ]

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, textAlign: 'center' }}>{t('resources.virtualMachines')}</Typography>
        <Box sx={{ width: '100%', height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                {data.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
              </Pie>
              <RTooltip />
            </PieChart>
          </ResponsiveContainer>
        </Box>
        <Stack direction="row" spacing={2} justifyContent="center">
          <Stack direction="row" alignItems="center" spacing={0.5}><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: COLORS.success }} /><Typography variant="caption">{kpis.vms.running} {t('resources.active')}</Typography></Stack>
          <Stack direction="row" alignItems="center" spacing={0.5}><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: COLORS.error }} /><Typography variant="caption">{kpis.vms.stopped} {t('resources.stopped')}</Typography></Stack>
        </Stack>
        <Typography variant="h5" fontWeight={700} textAlign="center" sx={{ mt: 1 }}>{kpis.vms.total} VMs</Typography>
      </CardContent>
    </Card>
  )
}
