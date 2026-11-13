'use client'

import { useMemo } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Tooltip, Typography, alpha, useTheme } from '@mui/material'

import { GuestGlyph, NodeGlyph, Section, deviceLabel, deviceStatus } from '@/components/gpu/GpuInventoryPanel'
import GpuGauge from '@/components/gpu/GpuGauge'
import GpuVendorLogo, { gpuVendor } from '@/components/gpu/GpuVendorLogo'
import { readingPerDevice, type VisibleGpuReading } from '@/lib/gpu/metricsShared'
import { memoryPct, pressureOf, type GpuPressure, type GpuThresholds } from '@/lib/gpu/pressure'
import type { GpuReport, GpuReportDevice } from '@/lib/gpu/report'

/** Temperature as a share of its scale: 30 °C (cold) to the operator's threshold + 10. */
export function tempPct(temp: number, t: GpuThresholds): number {
  return ((temp - 30) / Math.max(1, t.temp_c + 10 - 30)) * 100
}

type Group = {
  key: string
  cluster: string
  node: string
  online: boolean | null
  tiles: Array<{ device: GpuReportDevice; reading: VisibleGpuReading | null }>
}

function groups(report: GpuReport, readings: VisibleGpuReading[]): Group[] {
  const byDevice = readingPerDevice(readings)
  const online = new Map(report.nodes.map(n => [`${n.connId}|${n.node}`, n.online]))
  const out = new Map<string, Group>()
  for (const d of report.devices) {
    if (d.kind !== 'gpu') continue
    const key = `${d.connId}|${d.node}`
    const g = out.get(key) ?? {
      key,
      cluster: d.connectionName,
      node: d.node,
      online: online.get(key) ?? null,
      tiles: []
    }
    g.tiles.push({ device: d, reading: byDevice.get(d.key) ?? null })
    out.set(key, g)
  }
  return [...out.values()].sort((a, b) => a.cluster.localeCompare(b.cluster) || a.node.localeCompare(b.node))
}

/**
 * The columns of a GPU line, shared by the header and every line so they align
 * across the servers: model, state, holder, load, VRAM, temperature, power, alerts.
 */
const LINE_COLUMNS =
  'minmax(170px, 1.1fr) 104px minmax(170px, 1.3fr) repeat(3, minmax(150px, 1fr)) 96px minmax(120px, auto)'
const LINE_MIN_WIDTH = 1180

/** Every GPU of the scope: one block per server, one line per GPU of that server. */
export default function GpuTileMap({
  report,
  readings,
  thresholds,
  onSelect
}: {
  report: GpuReport
  readings: VisibleGpuReading[]
  thresholds: GpuThresholds
  onSelect?: (device: GpuReportDevice) => void
}) {
  const t = useTranslations('gpu')
  const grouped = useMemo(() => groups(report, readings), [report, readings])
  if (!grouped.length) return null

  const head = (label: string, align: 'left' | 'right' = 'left') => (
    <Typography variant='caption' color='text.secondary' sx={{ fontWeight: 600, textAlign: align }} noWrap>
      {label}
    </Typography>
  )

  return (
    <Section title={t('tiles.title')} icon='ri-layout-grid-line'>
      {/* A narrow screen scrolls the map sideways rather than squeezing the columns. */}
      <Box sx={{ overflowX: 'auto' }}>
        <Box
          sx={{ px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: LINE_MIN_WIDTH }}
          data-testid='gpu-card-map'
        >
          <Box sx={{ display: 'grid', gridTemplateColumns: LINE_COLUMNS, columnGap: 2, px: 1.5 }}>
            {head(t('workloads.colGpu'))}
            {head(t('workloads.colState'))}
            {head(t('colVm'))}
            {head(t('tiles.util'))}
            {head(t('tiles.memory'))}
            {head(t('tiles.temp'))}
            {head(t('load.colPower'), 'right')}
            <span />
          </Box>
          {grouped.map(g => (
            <Box
              key={g.key}
              data-testid='gpu-server'
              sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}
            >
              <GroupTitle cluster={g.cluster} node={g.node} online={g.online} />
              {g.tiles.map(({ device, reading }) => (
                <GpuCard
                  key={device.key}
                  device={device}
                  reading={reading}
                  thresholds={thresholds}
                  onSelect={onSelect}
                />
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    </Section>
  )
}

/** The cluster, then the node with its Proxmox glyph and state dot, as everywhere else. */
function GroupTitle({ cluster, node, online }: { cluster: string; node: string; online: boolean | null }) {
  const theme = useTheme()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75, bgcolor: 'action.hover' }}>
      <i className='ri-server-line' style={{ fontSize: '0.9rem', opacity: 0.7 }} aria-hidden />
      <Typography variant='caption' color='text.secondary' sx={{ fontWeight: 600 }}>
        {cluster}
      </Typography>
      <Typography variant='caption' color='text.disabled'>
        ·
      </Typography>
      <NodeGlyph online={online} dark={theme.palette.mode === 'dark'} dotBorder={theme.palette.background.paper} />
      <Typography variant='caption' color='text.secondary' sx={{ fontWeight: 600 }}>
        {node}
      </Typography>
    </Box>
  )
}

/** "GA102GL [RTX A5000]" reads "RTX A5000": the marketing name PVE puts in brackets. */
export function shortModel(
  device: Pick<GpuReportDevice, 'deviceName' | 'vendorName' | 'vendorId' | 'deviceId'>
): string {
  const name = device.deviceName ?? ''
  const bracket = /\[([^\]]+)\]/.exec(name)
  return bracket ? bracket[1] : name || deviceLabel(device)
}

type Level = 'normal' | 'warning' | 'error'

/** Under 20 points from the threshold: normal; then warning; at or past it: error. */
export function barLevel(pct: number, threshold: number): Level {
  if (pct >= threshold) return 'error'
  return pct >= threshold - 20 ? 'warning' : 'normal'
}

/** The worst state of a card: heat first, then load and memory, then a slowdown. */
export function cardLevel(p: GpuPressure | null, thermal: boolean): Level | null {
  if (!p) return null
  if (p.hot || thermal) return 'error'
  if (p.saturated || p.memoryPressure) return 'warning'
  return null
}

/** One reading of a GPU line: its bar, then its value. */
function Bar({
  label,
  pct,
  text,
  level,
  testId
}: {
  label: string
  pct: number | null
  text: string
  level: Level
  testId: string
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }} data-testid={testId}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <GpuGauge pct={pct} label={label} />
      </Box>
      <Typography
        variant='caption'
        color={level === 'error' ? 'error.main' : level === 'warning' ? 'warning.main' : 'text.primary'}
        sx={{
          width: 76,
          textAlign: 'right',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          flexShrink: 0
        }}
      >
        {text}
      </Typography>
    </Box>
  )
}

/**
 * Who holds a card, in a few words: the number of running vGPUs of a card in
 * vGPU mode, otherwise the VM (a running one first). Null when nobody does.
 */
export function holderText(device: GpuReportDevice, vgpus: (count: number) => string): string | null {
  if (device.vgpu?.mode === 'sriov') return vgpus(device.vms.filter(x => x.mdev && x.vmStatus === 'running').length)
  const holder = holderVm(device)
  return holder ? `${holder.vmName ?? ''} #${holder.vmid}` : null
}

/** The VM that holds a whole card, a running one first; null for a card in vGPU mode or a free one. */
function holderVm(device: GpuReportDevice): GpuReportDevice['vms'][number] | null {
  if (device.vgpu?.mode === 'sriov') return null
  return device.vms.find(x => x.vmStatus === 'running' && !x.hidden) ?? device.vms.find(x => !x.hidden) ?? null
}

/** Enter and Space open the detail, as a click does. */
const pressable = (open: (() => void) | undefined) =>
  open
    ? {
        role: 'button',
        tabIndex: 0,
        onClick: open,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }
      }
    : {}

function GpuCard({
  device,
  reading,
  thresholds,
  onSelect
}: {
  device: GpuReportDevice
  reading: VisibleGpuReading | null
  thresholds: GpuThresholds
  onSelect?: (device: GpuReportDevice) => void
}) {
  const t = useTranslations('gpu')
  const theme = useTheme()
  const status = deviceStatus(device)
  // A card in vGPU mode is shared: it shows how many vGPUs run on it.
  const holder = holderText(device, count => t('tiles.vgpus', { count }))
  const p = reading ? pressureOf(reading, thresholds) : null
  const level = cardLevel(p, !!reading?.thermal_slow)
  const accent =
    level === 'error'
      ? theme.palette.error.main
      : level === 'warning'
        ? theme.palette.warning.main
        : theme.palette.primary.main
  // The status in the theme's own colours (the inventory list keeps its fixed ones).
  const dot = {
    free: theme.palette.success.main,
    allocated: theme.palette.warning.main,
    inUse: theme.palette.primary.main,
    console: theme.palette.text.disabled
  }[status]
  const mem = reading ? memoryPct(reading.mem_used, reading.mem_total) : null
  const temp = reading?.temp ? tempPct(reading.temp, thresholds) : null
  const tempThresholdPct = tempPct(thresholds.temp_c, thresholds)
  // Saturation and full memory warn, heat is an error, a power cap is only
  // information: an AI load runs at its limit.
  type Flag = { text: string; tone: 'warning' | 'error' | 'info' }
  const flags: Flag[] = p
    ? ([
        p.saturated && { text: t('load.saturated'), tone: 'warning' },
        p.memoryPressure && { text: t('load.memoryPressure'), tone: 'warning' },
        p.hot && { text: t('load.hot'), tone: 'error' },
        p.throttled &&
          (reading?.thermal_slow
            ? { text: t('load.throttledThermal'), tone: 'error' }
            : { text: t('load.throttledPower'), tone: 'info' })
      ].filter(Boolean) as Flag[])
    : []

  return (
    <Box
      data-testid='gpu-card'
      data-measured={reading ? 'true' : 'false'}
      aria-label={onSelect ? t('tiles.openDetail', { gpu: shortModel(device) }) : undefined}
      {...pressable(onSelect && (() => onSelect(device)))}
      sx={{
        cursor: onSelect ? 'pointer' : 'default',
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: LINE_COLUMNS,
        columnGap: 2,
        alignItems: 'center',
        minHeight: 38,
        px: 1.5,
        borderTop: 1,
        borderColor: 'divider',
        transition: 'background-color .15s',
        '&:hover, &:focus-visible': onSelect ? { bgcolor: 'action.hover', outline: 'none' } : {}
      }}
    >
      {/* The worst state of the card, on its left edge. */}
      <Box
        sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, bgcolor: level ? accent : 'transparent' }}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <GpuVendorLogo vendor={gpuVendor(device)} size={18} />
        <Tooltip title={`${deviceLabel(device)} · ${device.id}`} arrow placement='top' disableInteractive>
          <Typography variant='body2' noWrap sx={{ fontWeight: 700, minWidth: 0 }}>
            {shortModel(device)}
          </Typography>
        </Tooltip>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dot, flexShrink: 0 }} />
        <Typography variant='caption' color='text.secondary' noWrap>
          {t(`status.${status}`)}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        {/* A VM with its state dot, as everywhere; a card in vGPU mode is held by several. */}
        {holderVm(device) ? (
          <GuestGlyph status={holderVm(device)!.vmStatus} dotBorder={theme.palette.background.paper} />
        ) : (
          <Box sx={{ width: 16, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
            {device.vgpu && <i className='ri-stack-line' style={{ fontSize: '0.9286rem', opacity: 0.8 }} aria-hidden />}
          </Box>
        )}
        <Typography variant='body2' noWrap color={holder ? 'text.primary' : 'text.secondary'} sx={{ minWidth: 0 }}>
          {holder ?? t('tiles.noVm')}
        </Typography>
      </Box>
      <Bar
        testId='gpu-card-util'
        label={t('tiles.util')}
        pct={reading ? reading.util : null}
        text={reading ? `${Math.round(reading.util)} %` : '-'}
        level={reading ? barLevel(reading.util, thresholds.util_pct) : 'normal'}
      />
      <Bar
        testId='gpu-card-memory'
        label={t('tiles.memory')}
        pct={mem}
        text={
          reading
            ? `${(reading.mem_used / 1024).toFixed(1)}/${Math.round(reading.mem_total / 1024)} ${t('tiles.gib')}`
            : '-'
        }
        level={mem !== null ? barLevel(mem, thresholds.memory_pct) : 'normal'}
      />
      <Bar
        testId='gpu-card-temp'
        label={t('tiles.temp')}
        pct={temp}
        text={reading?.temp ? `${Math.round(reading.temp)} °C` : '-'}
        level={temp !== null ? barLevel(temp, tempThresholdPct) : 'normal'}
      />
      <Typography
        variant='caption'
        color='text.secondary'
        noWrap
        sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
      >
        {reading ? `${Math.round(reading.power)} / ${Math.round(reading.power_limit)} W` : t('tiles.notMeasured')}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        {flags.map(f => {
          const color =
            f.tone === 'error'
              ? theme.palette.error.main
              : f.tone === 'warning'
                ? theme.palette.warning.main
                : theme.palette.text.secondary
          return (
            <Box
              key={f.text}
              data-tone={f.tone}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.25,
                px: 0.75,
                borderRadius: 1,
                bgcolor: alpha(color, 0.14),
                color,
                flexShrink: 0
              }}
            >
              <i
                className={f.tone === 'info' ? 'ri-flashlight-line' : 'ri-error-warning-line'}
                style={{ fontSize: '0.75rem' }}
                aria-hidden
              />
              <Typography variant='caption' noWrap sx={{ color: 'inherit', fontWeight: 600, lineHeight: 1.6 }}>
                {f.text}
              </Typography>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
