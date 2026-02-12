'use client'

import { useState } from 'react'
import {
  Box,
  Card,
  CardContent,
  LinearProgress,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'

import type { TopVm } from '../types'
import { COLORS } from '../constants'
import { formatPct } from '../helpers'
import { SpeedIcon, MemoryIcon } from './icons'

export default function TopVmsCompact({ cpuVms, ramVms, loading }: { cpuVms: TopVm[]; ramVms: TopVm[]; loading?: boolean }) {
  const [tab, setTab] = useState(0)

  if (loading) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Skeleton variant="text" width="40%" sx={{ mb: 2 }} />
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} variant="rectangular" height={36} sx={{ mb: 1, borderRadius: 1 }} />)}
        </CardContent>
      </Card>
    )
  }

  const vms = tab === 0 ? cpuVms : ramVms
  const color = tab === 0 ? COLORS.cpu : COLORS.ram
  const metric = tab === 0 ? 'cpu' : 'ram'

  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0, textTransform: 'none' } }}>
          <Tab icon={<SpeedIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Top CPU" />
          <Tab icon={<MemoryIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Top RAM" />
        </Tabs>
        <Stack spacing={1}>
          {vms.slice(0, 5).map((vm, index) => {
            const value = metric === 'cpu' ? vm.cpu : vm.ram
            return (
              <Box key={vm.id}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.25 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="caption" sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: alpha(color, index === 0 ? 0.2 : 0.1), color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{index + 1}</Typography>
                    <Typography variant="body2" fontWeight={index === 0 ? 600 : 400} noWrap sx={{ maxWidth: 150 }}>{vm.name}</Typography>
                  </Stack>
                  <Typography variant="body2" fontWeight={600} sx={{ color }}>{formatPct(value)}</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={Math.min(100, value)} sx={{ height: 3, borderRadius: 1, bgcolor: alpha(color, 0.1), '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 1 } }} />
              </Box>
            )
          })}
        </Stack>
      </CardContent>
    </Card>
  )
}
