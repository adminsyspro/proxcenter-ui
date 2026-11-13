'use client'

import { useMemo, useState } from 'react'

import { useLocale, useTranslations } from 'next-intl'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
  useTheme
} from '@mui/material'

import { deviceLabel, deviceStatus, GuestGlyph } from '@/components/gpu/GpuInventoryPanel'
import GpuVendorLogo, { gpuVendor } from '@/components/gpu/GpuVendorLogo'
import { useGpuSeries } from '@/components/gpu/useGpuMetrics'
import PagedRows from '@/components/ui/PagedRows'
import { getDateLocale } from '@/lib/i18n/date'
import { GPU_RANGES, type GpuRange, type VisibleGpuReading, type VisibleVgpuType } from '@/lib/gpu/metricsShared'
import { chartData, memoryPct, pressureOf, type GpuThresholds } from '@/lib/gpu/pressure'
import type { GpuReportDevice } from '@/lib/gpu/report'
import { profileName } from '@/lib/gpu/vgpu'

import { useGpuActions } from './GpuActionDialogs'
import GpuLineChart from './GpuLineChart'
import { shortModel } from './GpuTileMap'

const RANGES = Object.keys(GPU_RANGES) as GpuRange[]

/** One reading in a framed cell: label, value, an optional gauge, an optional line under it. */
export function Stat({
  label,
  value,
  sub,
  tone,
  testId,
  children
}: {
  label: string
  value: string
  sub?: string
  tone?: 'warning' | 'error' | null
  testId: string
  children?: React.ReactNode
}) {
  return (
    <Box
      data-testid={testId}
      sx={{ border: 1, borderColor: tone ? `${tone}.main` : 'divider', borderRadius: 2, px: 1.5, py: 1, minWidth: 0 }}
    >
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }} noWrap>
        {label}
      </Typography>
      <Typography variant='h6' sx={{ fontWeight: 700, color: tone ? `${tone}.main` : 'text.primary' }} noWrap>
        {value}
      </Typography>
      {children}
      {sub && (
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }} noWrap title={sub}>
          {sub}
        </Typography>
      )}
    </Box>
  )
}

/**
 * One GPU in detail (#672): who holds it, its live readings, and its history
 * over a range of its own. Opened from the GPU map of the overview; the
 * history is fetched only while it is open.
 */
export default function GpuDetailDialog({
  device,
  reading,
  thresholds,
  catalog = [],
  onClose
}: {
  device: GpuReportDevice | null
  reading: VisibleGpuReading | null
  thresholds: GpuThresholds
  /** The vGPU profiles of the cards, to name a vGPU by its profile rather than its mdev type. */
  catalog?: VisibleVgpuType[]
  onClose: () => void
}) {
  const t = useTranslations('gpu')
  const theme = useTheme()
  const actions = useGpuActions()
  const locale = getDateLocale(useLocale())
  const [range, setRange] = useState<GpuRange>('24h')
  const history = useGpuSeries(range, !!device)
  const h = history.data
  const withDate = range === '7d' || range === '30d'

  const charts = useMemo(() => {
    if (!h || !device) return null
    // A card shared out as vGPUs: its own (host) reading only; each vGPU has its detail.
    const all = h.series.filter(s => s.deviceKey === device.key)
    const host = all.filter(s => s.target.startsWith('node:'))
    const own = device.vgpu && host.length ? host : all
    if (!own.length) return null
    const others = t('load.others')
    return {
      util: chartData(own, 'util', h.from, h.to, h.stepSeconds, others),
      memory: chartData(own, 'memory', h.from, h.to, h.stepSeconds, others),
      temp: chartData(own, 'temp', h.from, h.to, h.stepSeconds, others),
      power: chartData(own, 'power', h.from, h.to, h.stepSeconds, others)
    }
  }, [h, device, t])

  if (!device) return null
  const status = deviceStatus(device)
  const holders = device.vms.filter(v => !v.hidden)
  const dotBorder = theme.palette.background.paper
  const p = reading ? pressureOf(reading, thresholds) : null
  const mem = reading ? memoryPct(reading.mem_used, reading.mem_total) : 0
  const gib = t('tiles.gib')
  const primary = theme.palette.primary.main
  const lastAt = reading?.at ? new Date(reading.at) : null

  return (
    <Dialog open onClose={onClose} maxWidth='lg' fullWidth aria-labelledby='gpu-detail-title' data-testid='gpu-detail'>
      <DialogTitle id='gpu-detail-title' sx={{ display: 'flex', alignItems: 'center', gap: 1.25, pr: 6 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2,
            display: 'grid',
            placeItems: 'center',
            bgcolor: alpha(primary, 0.1),
            flexShrink: 0
          }}
        >
          <GpuVendorLogo vendor={gpuVendor(device)} size={24} />
        </Box>
        {/* One line, the rule of the modals: the model, then where it sits. */}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <Typography variant='h6' sx={{ fontWeight: 700, lineHeight: 1.2, flexShrink: 0 }}>
            {shortModel(device)}
          </Typography>
          <Typography
            variant='body2'
            color='text.secondary'
            noWrap
            title={`${deviceLabel(device)} · ${device.connectionName} · ${device.node} · ${device.id}`}
          >
            {deviceLabel(device)} · {device.connectionName} · {device.node} · {device.id}
          </Typography>
        </Box>
        <IconButton aria-label={t('actions.close')} onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
          <i className='ri-close-line' />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.25, borderRadius: 1, bgcolor: alpha(primary, 0.1), flexShrink: 0 }}>
            <Typography variant='caption' sx={{ fontWeight: 600, color: 'primary.main' }}>
              {t(`status.${status}`)}
            </Typography>
          </Box>
          <Typography variant='subtitle2' sx={{ fontWeight: 700 }} noWrap>
            {t('colVms')} ({holders.length})
          </Typography>
          <Box sx={{ flex: 1 }} />
          {lastAt && (
            <Typography variant='caption' color='text.secondary' noWrap sx={{ flexShrink: 0 }}>
              {t('load.lastReading', { time: lastAt.toLocaleTimeString(locale) })}
            </Typography>
          )}
        </Box>

        {/* The VMs that hold the card: one line each, its state in the dot, its share on the right. */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: -1 }}>
          <Box
            data-testid='gpu-detail-holders'
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              maxHeight: 216,
              overflowY: 'auto',
              '& > div + div': { borderTop: 1, borderColor: 'divider' }
            }}
          >
            {holders.length === 0 ? (
              <Typography variant='body2' color='text.secondary' sx={{ px: 1.5, py: 1 }}>
                {t('tiles.noVm')}
              </Typography>
            ) : (
              <PagedRows items={holders} testId='gpu-detail-holders-pager'>
                {(v, i) => (
                  <Box
                    key={`${v.vmid}:${v.hostpci ?? i}`}
                    data-testid='gpu-detail-holder'
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 1.5,
                      height: 34
                    }}
                  >
                    <GuestGlyph status={v.vmStatus} dotBorder={dotBorder} />
                    <Typography variant='body2' noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                      {v.vmName ?? `VM ${v.vmid}`}
                    </Typography>
                    <Typography variant='body2' color='text.secondary' sx={{ flexShrink: 0 }}>
                      #{v.vmid}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Typography variant='body2' color='text.secondary' noWrap sx={{ width: 160, textAlign: 'right', flexShrink: 0 }}>
                      {v.mdev ? (profileName(v.mdev, device.key, catalog) ?? v.mdev) : t('workloads.wholeCard')}
                    </Typography>
                  </Box>
                )}
              </PagedRows>
            )}
          </Box>
        </Box>

        {reading ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1.25 }}>
            <Stat
              testId='gpu-detail-util'
              label={t('tiles.util')}
              value={`${Math.round(reading.util)} %`}
              sub={t('load.threshold', { value: thresholds.util_pct })}
              tone={p?.saturated ? 'warning' : null}
            />
            <Stat
              testId='gpu-detail-memory'
              label={t('tiles.memory')}
              value={`${Math.round(mem)} %`}
              sub={`${(reading.mem_used / 1024).toFixed(1)} / ${Math.round(reading.mem_total / 1024)} ${gib}`}
              tone={p?.memoryPressure ? 'warning' : null}
            />
            <Stat
              testId='gpu-detail-temp'
              label={t('tiles.temp')}
              value={reading.temp ? `${Math.round(reading.temp)} °C` : '-'}
              sub={t('load.tempThreshold', { value: thresholds.temp_c })}
              tone={p?.hot || reading.thermal_slow ? 'error' : null}
            />
            <Stat
              testId='gpu-detail-power'
              label={t('load.colPower')}
              value={`${Math.round(reading.power)} W`}
              sub={
                reading.power_slow
                  ? t('load.throttledPower')
                  : reading.thermal_slow
                    ? t('load.throttledThermal')
                    : `${t('detail.limit')} ${Math.round(reading.power_limit)} W`
              }
            />
          </Box>
        ) : (
          <Typography variant='body2' color='text.secondary' data-testid='gpu-detail-unmeasured'>
            {t('detail.unmeasured')}
          </Typography>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant='subtitle2' sx={{ fontWeight: 700, flex: 1 }}>
            {t('detail.history')}
          </Typography>
          <ToggleButtonGroup
            size='small'
            exclusive
            value={range}
            onChange={(_, v: GpuRange | null) => v && setRange(v)}
            aria-label={t('load.range')}
          >
            {RANGES.map(r => (
              <ToggleButton key={r} value={r} sx={{ px: 1.25, py: 0.25, fontSize: '0.75rem' }}>
                {t(`load.ranges.${r}`)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
        {history.loading && !h && <LinearProgress />}
        {charts ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
            <GpuLineChart
              color={primary}
              title={t('load.chartUtil')}
              unit='%'
              data={charts.util}
              domain={[0, 100]}
              threshold={{ value: thresholds.util_pct, label: t('load.thresholdShort') }}
              withDate={withDate}
            />
            <GpuLineChart
              color={primary}
              title={t('load.chartMemory')}
              unit='%'
              data={charts.memory}
              domain={[0, 100]}
              threshold={{ value: thresholds.memory_pct, label: t('load.thresholdShort') }}
              withDate={withDate}
            />
            <GpuLineChart
              color={primary}
              title={t('load.chartTemp')}
              unit='°'
              data={charts.temp}
              threshold={{ value: thresholds.temp_c, label: t('load.thresholdShort') }}
              withDate={withDate}
            />
            <GpuLineChart
              color={primary}
              title={t('load.chartPower')}
              unit=' W'
              data={charts.power}
              withDate={withDate}
            />
          </Box>
        ) : (
          !history.loading && (
            <Typography variant='body2' color='text.secondary' sx={{ py: 2, textAlign: 'center' }}>
              {t('load.noHistory')}
            </Typography>
          )
        )}
      </DialogContent>
      <DialogActions>
        {/* A whole card is given from here; a card in vGPU mode from the vGPU tab, by profile. */}
        {actions.canAct && device.kind === 'gpu' && !device.vgpu && (
          <Button
            startIcon={<i className='ri-links-line' />}
            data-testid='gpu-detail-attach'
            onClick={() => {
              onClose()
              actions.attach(device)
            }}
          >
            {t('actions.attachButton')}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>{t('actions.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
