'use client'

import { useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Box,
  Button,
  Chip,
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
  useTheme,
} from '@mui/material'

import { GuestGlyph } from '@/components/gpu/GpuInventoryPanel'
import GpuVendorLogo, { gpuVendor } from '@/components/gpu/GpuVendorLogo'
import { useGpuSeries } from '@/components/gpu/useGpuMetrics'
import { GPU_RANGES, type GpuRange, type VisibleVgpu } from '@/lib/gpu/metricsShared'
import { chartData, type GpuThresholds } from '@/lib/gpu/pressure'
import type { GpuReportAllocation, GpuReportDevice } from '@/lib/gpu/report'

import GpuLineChart from './GpuLineChart'
import { shortModel } from './GpuTileMap'

const RANGES = Object.keys(GPU_RANGES) as GpuRange[]

export type VgpuDetail = { device: GpuReportDevice; allocation: GpuReportAllocation; live: VisibleVgpu | null; profile: string; sizeMiB: number | null }

function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <Box data-testid={testId} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, px: 1.5, py: 1, minWidth: 0 }}>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{label}</Typography>
      <Typography variant='h6' sx={{ fontWeight: 700 }} noWrap>{value}</Typography>
      {sub && <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block' }}>{sub}</Typography>}
    </Box>
  )
}

/**
 * One vGPU in detail (#672): the VM, its profile, what it uses of its slice
 * and its license, then its history read from inside the VM. Temperature and
 * power belong to the physical card (a vGPU reports none): they are in the
 * card's own detail.
 */
export default function VgpuDetailDialog({
  detail,
  thresholds,
  onClose,
  onRelease,
}: {
  detail: VgpuDetail | null
  thresholds: GpuThresholds
  onClose: () => void
  onRelease?: () => void
}) {
  const t = useTranslations('gpu')
  const theme = useTheme()
  const primary = theme.palette.primary.main
  const unit = t('tiles.gib')
  const [range, setRange] = useState<GpuRange>('24h')
  const history = useGpuSeries(range, !!detail)
  const h = history.data
  const withDate = range === '7d' || range === '30d'

  const charts = useMemo(() => {
    if (!h || !detail) return null
    const own = h.series.filter(s => s.vmid === detail.allocation.vmid && s.deviceKey === detail.device.key)
    if (!own.length) return null
    const others = t('load.others')
    return {
      util: chartData(own, 'util', h.from, h.to, h.stepSeconds, others),
      memory: chartData(own, 'memory', h.from, h.to, h.stepSeconds, others),
    }
  }, [h, detail, t])

  if (!detail) return null
  const { device, allocation: a, live: v, profile, sizeMiB } = detail
  const gib = (mib: number) => (mib / 1024).toFixed(mib >= 10240 || mib % 1024 === 0 ? 0 : 1)

  return (
    <Dialog open onClose={onClose} maxWidth='md' fullWidth aria-labelledby='gpu-vgpu-detail-title' data-testid='gpu-vgpu-detail'>
      <DialogTitle id='gpu-vgpu-detail-title' sx={{ display: 'flex', alignItems: 'center', gap: 1.25, pr: 6 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(primary, 0.1), flexShrink: 0 }}>
          <GpuVendorLogo vendor={gpuVendor(device)} size={24} />
        </Box>
        {/* One line, the rule of the modals: the VM, then its profile and card. */}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <Typography variant='h6' sx={{ fontWeight: 700, lineHeight: 1.2, flexShrink: 0 }}>
            {a.vmName} <Typography component='span' variant='body2' color='text.secondary'>#{a.vmid}</Typography>
          </Typography>
          <Typography variant='body2' color='text.secondary' noWrap title={`${profile} · ${shortModel(device)} · ${device.connectionName} · ${device.node}`}>
            {profile} · {shortModel(device)} · {device.connectionName} · {device.node}
          </Typography>
        </Box>
        <IconButton aria-label={t('actions.close')} onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
          <i className='ri-close-line' />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <GuestGlyph status={a.vmStatus} dotBorder={theme.palette.background.paper} />
          <Typography variant='body2'>{a.vmStatus === 'running' ? t('detail.vm.running') : t('detail.vm.stopped')}</Typography>
          <Typography variant='caption' color='text.secondary' noWrap sx={{ minWidth: 0 }}>· {a.hostpci} · {a.mapping}</Typography>
          <Box sx={{ flex: 1 }} />
          {v && (
            <Chip
              size='small'
              variant='outlined'
              color={v.licensed ? 'success' : 'warning'}
              icon={<i className={v.licensed ? 'ri-shield-check-line' : 'ri-error-warning-line'} />}
              label={v.licensed ? t('vgpu.licensed') : t('vgpu.unlicensed')}
            />
          )}
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1.25 }}>
          <Stat testId='gpu-vgpu-detail-profile' label={t('actions.pickProfile')} value={profile.replace(/^.*-/, '')} sub={sizeMiB ? `${gib(sizeMiB)} ${unit}` : undefined} />
          <Stat
            testId='gpu-vgpu-detail-memory'
            label={t('tiles.memory')}
            value={v && v.fbTotal ? `${Math.round((v.fbUsed / v.fbTotal) * 100)} %` : '-'}
            sub={v ? t('vgpu.memoryUsed', { used: gib(v.fbUsed), total: gib(v.fbTotal) }) : undefined}
          />
          <Stat testId='gpu-vgpu-detail-util' label={t('tiles.util')} value={v ? `${Math.round(v.util)} %` : '-'} sub={t('load.threshold', { value: thresholds.util_pct })} />
          <Stat testId='gpu-vgpu-detail-driver' label={t('vgpu.guestDriver')} value={v?.guestDriver || '-'} />
        </Box>
        {!v && (
          <Typography variant='body2' color='text.secondary'>{a.vmStatus === 'running' ? t('vgpu.notRead') : t('vgpu.stoppedHint')}</Typography>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant='subtitle2' sx={{ fontWeight: 700, flex: 1 }}>{t('detail.history')}</Typography>
          <ToggleButtonGroup size='small' exclusive value={range} onChange={(_, r: GpuRange | null) => r && setRange(r)} aria-label={t('load.range')}>
            {RANGES.map(r => (
              <ToggleButton key={r} value={r} sx={{ px: 1.25, py: 0.25, fontSize: '0.75rem' }}>{t(`load.ranges.${r}`)}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
        {history.loading && !h && <LinearProgress />}
        {charts ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
            <GpuLineChart color={primary} title={t('load.chartUtil')} unit='%' data={charts.util} domain={[0, 100]} threshold={{ value: thresholds.util_pct, label: t('load.thresholdShort') }} withDate={withDate} />
            <GpuLineChart color={primary} title={t('load.chartMemory')} unit='%' data={charts.memory} domain={[0, 100]} threshold={{ value: thresholds.memory_pct, label: t('load.thresholdShort') }} withDate={withDate} />
          </Box>
        ) : (
          !history.loading && <Typography variant='body2' color='text.secondary' sx={{ py: 2, textAlign: 'center' }}>{t('vgpu.noHistory')}</Typography>
        )}
      </DialogContent>
      <DialogActions>
        {onRelease && (
          <Button color='warning' onClick={onRelease} startIcon={<i className='ri-link-unlink' />}>{t('vgpu.release')}</Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>{t('actions.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
