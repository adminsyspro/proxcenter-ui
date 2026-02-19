'use client'

import { useEffect, useState, useCallback } from 'react'

import {
  Box,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  Stack,
  Typography,
  useTheme,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import type { VmIdentity } from '../types'
import type { RrdTimeframe, SeriesPoint } from '../../inventory/types'
import { fetchRrd, buildSeriesFromRrd } from '../../inventory/helpers'
import { AreaPctChart, AreaBpsChart2 } from '../../inventory/components/RrdCharts'
import { COLORS } from '../constants'

type Props = {
  vm: VmIdentity | null
  onClose: () => void
}

const TIMEFRAME_OPTIONS: { label: string; value: RrdTimeframe }[] = [
  { label: '1h', value: 'hour' },
  { label: '24h', value: 'day' },
  { label: '7d', value: 'week' },
  { label: '30d', value: 'month' },
  { label: '1y', value: 'year' },
]

export default function VmDetailDrawer({ vm, onClose }: Props) {
  const theme = useTheme()
  const t = useTranslations()
  const [tf, setTf] = useState<RrdTimeframe>('hour')
  const [series, setSeries] = useState<SeriesPoint[]>([])
  const [loading, setLoading] = useState(false)

  const loadRrd = useCallback(async () => {
    if (!vm) return
    setLoading(true)
    try {
      const path = `/nodes/${vm.node}/${vm.type}/${vm.vmid}`
      const raw = await fetchRrd(vm.connId, path, tf)
      setSeries(buildSeriesFromRrd(raw))
    } catch (e) {
      console.error('Failed to fetch VM RRD:', e)
      setSeries([])
    } finally {
      setLoading(false)
    }
  }, [vm?.connId, vm?.node, vm?.type, vm?.vmid, tf])

  useEffect(() => {
    if (vm) loadRrd()
  }, [vm, loadRrd])

  // Reset timeframe when VM changes
  useEffect(() => {
    setTf('hour')
  }, [vm?.id])

  return (
    <Drawer
      anchor="right"
      open={!!vm}
      onClose={onClose}
      PaperProps={{
        sx: { width: { xs: '100%', sm: 520 }, p: 0 },
      }}
    >
      {vm && (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: 'divider' }}
          >
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <i className="ri-computer-line" style={{ fontSize: 22, color: COLORS.primary }} />
              <Box>
                <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.3 }}>
                  {vm.name}
                </Typography>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Chip
                    size="small"
                    label={vm.node}
                    sx={{ height: 20, fontSize: 10, fontWeight: 600 }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {String(vm.type).toUpperCase()} #{vm.vmid}
                  </Typography>
                </Stack>
              </Box>
            </Stack>
            <IconButton onClick={onClose} size="small">
              <i className="ri-close-line" style={{ fontSize: 20 }} />
            </IconButton>
          </Stack>

          {/* Timeframe selector */}
          <Stack direction="row" spacing={0.5} sx={{ px: 2.5, py: 1.5 }}>
            {TIMEFRAME_OPTIONS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                size="small"
                onClick={() => setTf(opt.value)}
                sx={{
                  height: 24,
                  fontSize: 11,
                  fontWeight: 600,
                  bgcolor: tf === opt.value ? 'primary.main' : 'action.hover',
                  color: tf === opt.value ? 'primary.contrastText' : 'text.secondary',
                  '&:hover': { bgcolor: tf === opt.value ? 'primary.dark' : 'action.selected' },
                }}
              />
            ))}
          </Stack>

          {/* Charts */}
          <Box sx={{ flex: 1, overflow: 'auto', px: 2.5, pb: 3 }}>
            {loading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 10 }}>
                <CircularProgress size={28} />
              </Box>
            ) : series.length === 0 ? (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 10 }}>
                <Typography variant="body2" color="text.secondary">{t('resources.noTrendData')}</Typography>
              </Box>
            ) : (
              <Stack spacing={2}>
                <AreaPctChart
                  title={t('resources.cpuUsage')}
                  data={series}
                  dataKey="cpuPct"
                  color={COLORS.cpu}
                  height={200}
                />
                <AreaPctChart
                  title={t('resources.memoryUsage')}
                  data={series}
                  dataKey="ramPct"
                  color={COLORS.ram}
                  height={200}
                />
                <AreaBpsChart2
                  title={t('resources.networkIoDetail')}
                  data={series}
                  keyA="netInBps"
                  keyB="netOutBps"
                  labelA="In"
                  labelB="Out"
                  colorA={COLORS.info}
                  colorB={COLORS.network}
                  height={200}
                />
                <AreaBpsChart2
                  title={t('resources.diskIoDetail')}
                  data={series}
                  keyA="diskReadBps"
                  keyB="diskWriteBps"
                  labelA="Read"
                  labelB="Write"
                  colorA={COLORS.success}
                  colorB={COLORS.warning}
                  height={200}
                />
              </Stack>
            )}
          </Box>
        </Box>
      )}
    </Drawer>
  )
}
