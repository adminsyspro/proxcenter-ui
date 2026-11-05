'use client'

import { useMemo, useState } from 'react'

import { useLocale, useTranslations } from 'next-intl'
import { Alert, Box, Button, Chip, LinearProgress, Typography } from '@mui/material'

import { useGpuLatest, useGpuSeries } from '@/components/gpu/useGpuMetrics'
import type { FleetScope } from '@/lib/gpu/fleet'
import { getDateLocale } from '@/lib/i18n/date'
import { readingPerDevice } from '@/lib/gpu/metricsShared'
import { fleetLoad, fleetTrend } from '@/lib/gpu/pressure'
import type { GpuReport, GpuReportDevice } from '@/lib/gpu/report'

import GpuDetailDialog from './GpuDetailDialog'
import GpuTileMap from './GpuTileMap'
import LoadKpis from './LoadKpis'

const inScope = (scope: FleetScope, connId: string, node: string) =>
  (!scope.connId || connId === scope.connId) && (!scope.node || node === scope.node)

/**
 * Load and pressure of the GPUs (#672) within the page filters: what they do
 * now, one card per GPU; a click opens its detail and history. Readings come
 * from inside the opted-in VMs (passthrough) or from the opted-in hosts;
 * nothing is read until an administrator opts targets in.
 */
export default function LoadDashboard({
  report,
  scope = {},
  onConfigure
}: {
  report: GpuReport
  scope?: FleetScope
  onConfigure?: () => void
}) {
  const t = useTranslations('gpu.load')
  const tTiles = useTranslations('gpu.tiles')
  const locale = getDateLocale(useLocale())
  const latest = useGpuLatest()
  const l = latest.data
  const [selected, setSelected] = useState<GpuReportDevice | null>(null)

  const gpus = useMemo(() => (l?.gpus ?? []).filter(g => inScope(scope, g.connection_id, g.node)), [l, scope])
  // The last six hours behind the figures: one read of the orchestrator's
  // history per minute, nothing asked of Proxmox.
  const history = useGpuSeries('6h', !!l?.configured && !!l?.enabled)
  const trend = useMemo(() => {
    const h = history.data
    if (!h) return []
    return fleetTrend(h.series.filter(s => inScope(scope, s.connectionId, s.node)), h.from, h.to, h.stepSeconds)
  }, [history.data, scope])

  if (latest.error === 'orchestrator_unavailable') {
    return <Alert severity='warning'>{t('orchestratorUnavailable')}</Alert>
  }
  if (!l)
    return latest.loading ? <LinearProgress /> : latest.error ? <Alert severity='error'>{t('loadError')}</Alert> : null

  if (!l.configured || !l.enabled) {
    return (
      <Alert
        severity='info'
        icon={<i className='ri-pulse-line' />}
        action={
          onConfigure && (
            <Button size='small' onClick={onConfigure}>
              {t('configure')}
            </Button>
          )
        }
        data-testid='gpu-load-unconfigured'
      >
        {!l.enabled ? t('disabled') : t('notConfigured')}
      </Alert>
    )
  }

  // One reading per card: the host's for a card shared out as vGPUs.
  const fleet = fleetLoad([...readingPerDevice(gpus).values(), ...gpus.filter(g => !g.deviceKey)], l.thresholds)
  const failing = l.probes.filter(
    p => p.status !== 'ok' && p.status !== 'not_running' && inScope(scope, p.connection_id, p.node ?? '')
  ).length
  const lastAt = l.at && !l.at.startsWith('0001') ? new Date(l.at) : null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid='gpu-load'>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant='subtitle1' sx={{ fontWeight: 700, flex: 1 }}>
          {t('title')}
        </Typography>
        {failing > 0 && (
          <Chip
            size='small'
            color='warning'
            variant='outlined'
            icon={<i className='ri-alert-line' />}
            label={t('probesFailing', { count: failing })}
            onClick={onConfigure}
          />
        )}
        {lastAt && (
          <Typography variant='caption' color='text.secondary'>
            {t('lastReading', { time: lastAt.toLocaleTimeString(locale) })}
          </Typography>
        )}
      </Box>

      <LoadKpis fleet={fleet} thresholds={l.thresholds} trend={trend} unit={tTiles('gib')} />

      <GpuTileMap report={report} readings={gpus} thresholds={l.thresholds} onSelect={setSelected} />
      <GpuDetailDialog
        device={selected}
        reading={selected ? (gpus.find(g => g.deviceKey === selected.key) ?? null) : null}
        thresholds={l.thresholds}
        catalog={l.vgpuTypes}
        onClose={() => setSelected(null)}
      />
    </Box>
  )
}
