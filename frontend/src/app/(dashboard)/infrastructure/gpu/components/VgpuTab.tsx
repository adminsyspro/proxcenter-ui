'use client'

import { useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Alert, Box, Button, Chip, IconButton, LinearProgress, Menu, MenuItem, Tooltip, Typography, alpha, useTheme } from '@mui/material'

import { GuestGlyph } from '@/components/gpu/GpuInventoryPanel'
import GpuGauge, { gaugeTone } from '@/components/gpu/GpuGauge'
import GpuVendorLogo, { gpuVendor } from '@/components/gpu/GpuVendorLogo'
import { useGpuLatest } from '@/components/gpu/useGpuMetrics'
import { readingPerDevice, type VisibleGpuReading, type VisibleVgpu, type VisibleVgpuType } from '@/lib/gpu/metricsShared'
import type { GpuReport, GpuReportAllocation, GpuReportDevice } from '@/lib/gpu/report'
import { profileMemory, profileName } from '@/lib/gpu/vgpu'

import { useGpuActions } from './GpuActionDialogs'
import GpuDetailDialog, { Stat } from './GpuDetailDialog'
import { shortModel } from './GpuTileMap'
import VgpuDetailDialog, { type VgpuDetail } from './VgpuDetailDialog'

const gib = (mib: number) => (mib / 1024).toFixed(mib >= 10240 || mib % 1024 === 0 ? 0 : 1)

/** The cards of the scope that share themselves out as vGPUs (SR-IOV). */
export const vgpuCards = (report: GpuReport) => report.devices.filter(d => d.kind === 'gpu' && d.vgpu?.mode === 'sriov')

// VM, profile, GPU memory, share of the card, license, action: one line each.
const ROW_COLUMNS = 'minmax(0, 1.4fr) 120px minmax(170px, 1.2fr) minmax(140px, 1fr) 120px 40px'

const DEFAULT_THRESHOLDS = { util_pct: 90, memory_pct: 90, temp_c: 85 }

/** "Give a vGPU" in the page bar: straight to the card when there is one, a pick otherwise. */
export function VgpuAttachButton({ cards, onPick }: { cards: GpuReportDevice[]; onPick: (d: GpuReportDevice) => void }) {
  const t = useTranslations('gpu.vgpu')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  if (!cards.length) return null
  return (
    <>
      <Button
        size='small'
        variant='contained'
        startIcon={<i className='ri-add-line' />}
        data-testid='gpu-vgpu-attach'
        onClick={e => (cards.length === 1 ? onPick(cards[0]) : setAnchor(e.currentTarget))}
      >
        {t('attach')}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {cards.map(d => (
          <MenuItem
            key={d.key}
            onClick={() => {
              setAnchor(null)
              onPick(d)
            }}
          >
            {shortModel(d)} · {d.connectionName} · {d.node}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

/**
 * The vGPU view (#672): per card in vGPU mode, the frame buffer its profiles
 * reserve, the physical load read on its host, and one row per VM with its
 * profile, its own load and its license.
 */
export default function VgpuTab({ report }: { report: GpuReport }) {
  const t = useTranslations('gpu.vgpu')
  const latest = useGpuLatest()
  const l = latest.data
  const cards = useMemo(() => vgpuCards(report), [report])
  const host = useMemo(() => readingPerDevice(l?.gpus ?? []), [l])
  const thresholds = l?.thresholds ?? DEFAULT_THRESHOLDS
  const actions = useGpuActions()
  const [cardOpen, setCardOpen] = useState<GpuReportDevice | null>(null)
  const [vgpuOpen, setVgpuOpen] = useState<VgpuDetail | null>(null)
  const physicalOf = (d: GpuReportDevice) => (host.get(d.key)?.source === 'host' ? (host.get(d.key) ?? null) : null)

  if (!cards.length) return <Alert severity='info'>{t('none')}</Alert>
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid='gpu-vgpu-tab'>
      {latest.loading && !l && <LinearProgress />}
      {cards.map(d => (
        <VgpuCard
          key={d.key}
          device={d}
          allocations={report.allocations.filter(a => a.deviceKey === d.key && a.kind === 'gpu')}
          physical={physicalOf(d)}
          vgpus={(l?.vgpus ?? []).filter(v => v.deviceKey === d.key)}
          catalog={(l?.vgpuTypes ?? []).filter(c => c.deviceKey === d.key)}
          thresholds={thresholds}
          onOpenCard={() => setCardOpen(d)}
          onOpenVgpu={setVgpuOpen}
        />
      ))}
      <GpuDetailDialog device={cardOpen} reading={cardOpen ? physicalOf(cardOpen) : null} thresholds={thresholds} catalog={l?.vgpuTypes} onClose={() => setCardOpen(null)} />
      <VgpuDetailDialog
        detail={vgpuOpen}
        thresholds={thresholds}
        onClose={() => setVgpuOpen(null)}
        onRelease={
          actions.canAct && vgpuOpen?.allocation.hostpci && vgpuOpen.allocation.vmid
            ? () => {
                const a = vgpuOpen.allocation
                setVgpuOpen(null)
                actions.release(releaseTarget(vgpuOpen.device, a, vgpuOpen.profile))
              }
            : undefined
        }
      />
    </Box>
  )
}

const releaseTarget = (device: GpuReportDevice, a: GpuReportAllocation, profile: string) => ({
  connId: a.connId,
  node: a.node,
  vmid: a.vmid as string,
  vmName: a.vmName,
  hostpci: a.hostpci as string,
  deviceName: `${shortModel(device)} ${profile.replace(/^.*-/, '')}`,
  vmStatus: a.vmStatus,
})

/** A gauge and its figure side by side, on the line of a vGPU. */
function GaugeCell({ pct, text, label }: { pct: number; text: string; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box sx={{ flex: 1, minWidth: 40 }}>
        <GpuGauge pct={pct} label={label} height={6} />
      </Box>
      <Typography variant='caption' noWrap sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{text}</Typography>
    </Box>
  )
}

/** Enter and Space open a detail, as a click does. */
const opens = (open: () => void) => ({
  role: 'button',
  tabIndex: 0,
  onClick: open,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    }
  },
})

function VgpuCard({
  device,
  allocations,
  physical,
  vgpus,
  catalog,
  thresholds,
  onOpenCard,
  onOpenVgpu,
}: {
  device: GpuReportDevice
  allocations: GpuReportAllocation[]
  physical: VisibleGpuReading | null
  vgpus: VisibleVgpu[]
  catalog: VisibleVgpuType[]
  thresholds: typeof DEFAULT_THRESHOLDS
  onOpenCard: () => void
  onOpenVgpu: (detail: VgpuDetail) => void
}) {
  const t = useTranslations('gpu.vgpu')
  const tg = useTranslations('gpu')
  const unit = useTranslations('gpu.tiles')('gib')
  const theme = useTheme()
  const actions = useGpuActions()
  const primary = theme.palette.primary.main

  const vgpuRows = allocations
    .filter(a => a.mdev && !a.hidden)
    .sort((a, b) => Number(b.vmStatus === 'running') - Number(a.vmStatus === 'running') || Number(a.vmid) - Number(b.vmid))
  const hiddenVgpus = allocations.filter(a => a.mdev && a.hidden).length
  // A whole-card passthrough cannot start while the card is in vGPU mode.
  const passthrough = allocations.filter(a => !a.mdev && !a.template && !a.hidden)
  const live = new Map(vgpus.map(v => [v.vmid, v]))

  // Frame buffer: what the running vGPUs reserve, against the card's.
  // The profiles share the card's frame buffer as its largest profile sizes it
  // (24 GiB on an A5000); the host reports a little less once its own share is out.
  const total = Math.max(catalog.reduce((m, c) => Math.max(m, c.fbMemory), 0), physical?.mem_total ?? 0)
  const reserved = vgpus.reduce((s, v) => s + v.fbTotal, 0)
  const configured = vgpuRows.reduce((s, a) => s + (profileMemory(a.mdev, device.key, catalog) ?? 0), 0)
  const profiles = vgpus.reduce<Record<string, number>>((m, v) => ({ ...m, [v.profile]: (m[v.profile] ?? 0) + 1 }), {})

  return (
    <Box data-testid='gpu-vgpu-card' sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Box
        data-testid='gpu-vgpu-card-head'
        aria-label={t('openCard', { gpu: shortModel(device) })}
        {...opens(onOpenCard)}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', bgcolor: alpha(primary, 0.04), cursor: 'pointer', '&:hover, &:focus-visible': { bgcolor: alpha(primary, 0.09), outline: 'none' } }}
      >
        <Box sx={{ width: 36, height: 36, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(primary, 0.1), flexShrink: 0 }}>
          <GpuVendorLogo vendor={gpuVendor(device)} size={22} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant='subtitle1' sx={{ fontWeight: 700, lineHeight: 1.2 }}>{shortModel(device)}</Typography>
          <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block' }}>
            {device.connectionName} · {device.node} · {device.id}
          </Typography>
        </Box>
        <Chip size='small' label={t('mode', { count: device.vgpu?.virtualFunctions.length ?? 0 })} sx={{ bgcolor: alpha(primary, 0.12), color: 'primary.main', fontWeight: 600, flexShrink: 0 }} />
        <Typography variant='body2' noWrap sx={{ fontWeight: 600, flexShrink: 0 }} data-testid='gpu-vgpu-count'>{t('running', { count: vgpus.length })}</Typography>
      </Box>

      {/* The card in five readings, framed like the GPU detail: what its vGPUs hold, then the physical card. */}
      <Box sx={{ px: 2, py: 1.5, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 1.25 }}>
        <Stat
          testId='gpu-vgpu-reserved'
          label={t('kpiReserved')}
          value={total ? t('reservedOf', { used: gib(reserved), total: gib(total) }) : '-'}
          sub={Object.entries(profiles).map(([p, n]) => `${n} × ${p.replace(/^.*-/, '')}`).join(', ') || undefined}
        >
          <Box sx={{ my: 0.5 }}>
            <GpuGauge pct={total ? (reserved / total) * 100 : 0} label={t('kpiReserved')} />
          </Box>
        </Stat>
        <Stat testId='gpu-vgpu-given' label={t('kpiGiven')} value={`${gib(configured)} ${unit}`} sub={t('kpiGivenSub')} />
        <Stat
          testId='gpu-vgpu-physical'
          label={tg('tiles.util')}
          value={physical ? `${Math.round(physical.util)} %` : '-'}
          sub={tg('load.threshold', { value: thresholds.util_pct })}
          tone={physical && gaugeTone(physical.util, thresholds.util_pct) === 'error.main' ? 'error' : null}
        />
        <Stat
          testId='gpu-vgpu-temp'
          label={tg('tiles.temp')}
          value={physical?.temp ? `${Math.round(physical.temp)} °C` : '-'}
          sub={tg('load.tempThreshold', { value: thresholds.temp_c })}
          tone={physical && physical.temp >= thresholds.temp_c ? 'error' : null}
        />
        <Stat
          testId='gpu-vgpu-power'
          label={tg('load.colPower')}
          value={physical ? `${Math.round(physical.power)} W` : '-'}
          sub={physical ? `${tg('detail.limit')} ${Math.round(physical.power_limit)} W` : undefined}
        />
      </Box>
      {!physical && (
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', px: 2, mt: -0.5, mb: 1.5 }}>{t('physicalUnread')}</Typography>
      )}

      {passthrough.length > 0 && (
        <Alert severity='warning' sx={{ mx: 2, mb: 1.5 }} data-testid='gpu-vgpu-passthrough'>
          {t('passthroughConflict', { vms: passthrough.map(a => `${a.vmName ?? ''} #${a.vmid}`).join(', ') })}
        </Alert>
      )}

      <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
        {vgpuRows.length > 0 && (
          <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: ROW_COLUMNS, gap: 1.5, px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
            {[t('colVm'), t('colProfile'), t('colMemory')].map(h => (
              <Typography key={h} variant='caption' color='text.secondary' sx={{ fontWeight: 600 }}>{h}</Typography>
            ))}
            <Tooltip title={t('colShareHint')} disableInteractive>
              <Typography variant='caption' color='text.secondary' sx={{ fontWeight: 600, cursor: 'help', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {t('colShare')} <i className='ri-information-line' aria-hidden />
              </Typography>
            </Tooltip>
            <Typography variant='caption' color='text.secondary' sx={{ fontWeight: 600 }}>{t('colLicense')}</Typography>
            <span />
          </Box>
        )}
        {vgpuRows.length === 0 && (
          <Typography variant='body2' color='text.secondary' sx={{ px: 2, py: 1.5 }}>{t('empty')}</Typography>
        )}
        {vgpuRows.map(a => {
          const v = a.vmid ? live.get(a.vmid) : undefined
          const name = v?.profile ?? profileName(a.mdev, device.key, catalog) ?? a.mdev ?? '?'
          const size = v?.fbTotal ?? profileMemory(a.mdev, device.key, catalog)
          return (
            <Box
              key={`${a.vmid}-${a.hostpci}`}
              data-testid='gpu-vgpu-row'
              aria-label={t('openVgpu', { vm: a.vmName ?? `#${a.vmid}` })}
              {...opens(() => onOpenVgpu({ device, allocation: a, live: v ?? null, profile: name, sizeMiB: size ?? null }))}
              sx={{ cursor: 'pointer', '&:hover, &:focus-visible': { bgcolor: alpha(primary, 0.05), outline: 'none' }, display: 'grid', gridTemplateColumns: { xs: '1fr', md: ROW_COLUMNS }, alignItems: 'center', gap: 1.5, px: 2, py: 1, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <GuestGlyph status={a.vmStatus} dotBorder={theme.palette.background.paper} />
                <Typography variant='body2' sx={{ fontWeight: 600 }} noWrap>{a.vmName}</Typography>
                <Typography variant='caption' color='text.secondary'>#{a.vmid}</Typography>
              </Box>
              <Typography variant='body2' noWrap>
                {name.replace(/^.*-/, '')}
                {size ? <Typography component='span' variant='caption' color='text.secondary'> · {gib(size)} {unit}</Typography> : null}
              </Typography>
              {v ? (
                <GaugeCell pct={v.fbTotal ? (v.fbUsed / v.fbTotal) * 100 : 0} text={`${gib(v.fbUsed)} / ${gib(v.fbTotal)} ${unit}`} label={t('memoryUsed', { used: gib(v.fbUsed), total: gib(v.fbTotal) })} />
              ) : (
                <Typography variant='caption' color='text.secondary' noWrap>{a.vmStatus === 'running' ? t('notRead') : t('stopped')}</Typography>
              )}
              {v ? <GaugeCell pct={v.util} text={`${Math.round(v.util)} %`} label={t('colShare')} /> : <Typography variant='caption' color='text.secondary'>-</Typography>}
              <Box>
                {v && (
                  <Chip
                    size='small'
                    variant='outlined'
                    color={v.licensed ? 'success' : 'warning'}
                    icon={<i className={v.licensed ? 'ri-shield-check-line' : 'ri-error-warning-line'} />}
                    label={v.licensed ? t('licensed') : t('unlicensed')}
                  />
                )}
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                {actions.canAct && a.hostpci && a.vmid && (
                  <Tooltip title={t('release')}>
                    <IconButton
                      size='small'
                      color='warning'
                      aria-label={t('release')}
                      onClick={e => {
                        e.stopPropagation()
                        actions.release(releaseTarget(device, a, name))
                      }}
                      onKeyDown={e => e.stopPropagation()}
                    >
                      <i className='ri-link-unlink' style={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          )
        })}
        {hiddenVgpus > 0 && (
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', px: 2, py: 1 }}>{t('hidden', { count: hiddenVgpus })}</Typography>
        )}
      </Box>

    </Box>
  )
}
