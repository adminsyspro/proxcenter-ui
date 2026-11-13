'use client'

import { useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Chip, IconButton, Menu, MenuItem, Tooltip, Typography, alpha, useTheme } from '@mui/material'

import { GuestGlyph, NodeGlyph, Pager, Section, deviceLabel, usePaged } from '@/components/gpu/GpuInventoryPanel'
import GpuGauge, { gaugeTone } from '@/components/gpu/GpuGauge'
import GpuVendorLogo, { gpuVendor } from '@/components/gpu/GpuVendorLogo'
import { useGpuLatest } from '@/components/gpu/useGpuMetrics'
import { useLicense, Features } from '@/contexts/LicenseContext'
import { workloads, type GpuWorkload } from '@/lib/gpu/fleet'
import type { VisibleGpuReading, VisibleVgpu } from '@/lib/gpu/metricsShared'
import { memoryPct } from '@/lib/gpu/pressure'
import type { GpuReport, GpuReportAllocation, GpuReportDevice } from '@/lib/gpu/report'
import { profileMemory, profileName } from '@/lib/gpu/vgpu'
import { formatUptime } from '@/utils/format'

import { useGpuActions } from './GpuActionDialogs'
import GpuDetailDialog from './GpuDetailDialog'
import GpuFilters, { NO_FILTER, matchesSearch, type GpuFilterState } from './GpuFilters'
import { KpiFrame, KpiHead } from './LoadKpis'
import { shortModel } from './GpuTileMap'
import VgpuDetailDialog, { type VgpuDetail } from './VgpuDetailDialog'

// VM (rest), GPU, state, place, uptime, load, GPU memory, actions.
const COLUMNS = 'minmax(0, 1.3fr) minmax(0, 1fr) 170px minmax(0, 1fr) 90px 130px 150px 76px'
const DEFAULT_THRESHOLDS = { util_pct: 90, memory_pct: 90, temp_c: 85 }

/** The live load of a VM: its busiest GPU, and the GPU memory it uses over what it holds. */
export type VmLoad = { util: number; memUsed: number; memTotal: number }

/** MiB as GiB with one decimal when it tells something: 22.5, 24. */
const gib = (mib: number) => {
  const v = Math.round(mib / 102.4) / 10
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function Meter({ pct, label, testId }: { pct: number; label: string; testId?: string }) {
  return (
    <Box sx={{ minWidth: 0 }} data-testid={testId}>
      <GpuGauge pct={pct} label={label} />
      <Typography variant='caption' color={gaugeTone(pct, 90)} sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{label}</Typography>
    </Box>
  )
}

/** A GPU of a VM: its vendor, model and how it is given (a vGPU profile or the whole card). */
function GpuChip({ a, profile, onOpen }: { a: GpuReportAllocation; profile: string | null; onOpen?: () => void }) {
  const t = useTranslations('gpu.workloads')
  const theme = useTheme()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <GpuVendorLogo vendor={gpuVendor(a)} size={16} />
      <Typography variant='body2' noWrap title={deviceLabel(a)} sx={{ minWidth: 0 }}>
        {shortModel(a)}
      </Typography>
      <Chip
        size='small'
        onClick={onOpen ? e => (e.stopPropagation(), onOpen()) : undefined}
        label={profile ? `vGPU ${profile.replace(/^.*-/, '')}` : t('wholeCard')}
        sx={{ height: 18, fontSize: '0.68rem', fontWeight: 600, flexShrink: 0, bgcolor: alpha(profile ? theme.palette.primary.main : theme.palette.info.main, 0.14), color: profile ? 'primary.main' : 'info.main' }}
      />
    </Box>
  )
}

/** What stands in the way of a VM's GPU, in words: a whole card already taken or shared out as vGPUs. */
function StateCell({ w }: { w: GpuWorkload }) {
  const t = useTranslations('gpu.page')
  const tg = useTranslations('gpu')
  if (w.conflict) {
    const hint =
      w.conflict.kind === 'vgpuMode'
        ? t('conflictVgpuHint')
        : w.conflict.others.length
          ? t('conflictSharedHint', { vms: w.conflict.others.join(', ') })
          : t('conflictSharedHintHidden')
    return (
      <Tooltip title={hint}>
        <Box data-testid='gpu-workload-conflict' sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'warning.main', minWidth: 0, cursor: 'help' }}>
          <i className='ri-error-warning-line' style={{ fontSize: 16, flexShrink: 0 }} aria-hidden />
          <Typography variant='body2' sx={{ color: 'inherit', fontWeight: 600 }} noWrap>
            {w.conflict.kind === 'vgpuMode' ? t('conflictVgpu') : t('conflictShared')}
          </Typography>
        </Box>
      </Tooltip>
    )
  }
  if (w.template) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
        <i className='ri-file-copy-2-line' style={{ fontSize: 16 }} aria-hidden />
        <Typography variant='body2' sx={{ color: 'inherit' }}>{tg('template')}</Typography>
      </Box>
    )
  }
  return <Typography variant='body2' color='text.secondary'>-</Typography>
}

function WorkloadRow({
  w,
  showCluster,
  load,
  profileOf,
  onOpen,
}: {
  w: GpuWorkload
  showCluster: boolean
  load: VmLoad | undefined
  profileOf: (a: GpuReportAllocation) => string | null
  onOpen: ((a: GpuReportAllocation) => void) | null
}) {
  const t = useTranslations()
  const actions = useGpuActions()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const gpus = w.gpus.filter(a => a.kind === 'gpu')
  const releasable = gpus.filter(a => a.hostpci)
  const running = w.vmStatus === 'running'
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const release = (a: GpuReportAllocation) =>
    actions.release({ connId: w.connId, node: w.node, vmid: w.vmid, vmName: w.vmName, hostpci: a.hostpci as string, deviceName: a.deviceName, vmStatus: w.vmStatus, raw: a.via === 'address' })
  const open = onOpen && gpus[0] ? () => onOpen(gpus[0]) : null

  return (
    <Box
      data-testid='gpu-workload-row'
      {...(open
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': t('gpu.workloads.open', { vm: w.vmName ?? `#${w.vmid}` }),
            onClick: open,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                open()
              }
            },
          }
        : {})}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: COLUMNS },
        gap: 1.5,
        alignItems: 'center',
        px: 1.5,
        py: 1,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-child': { borderBottom: 0 },
        cursor: open ? 'pointer' : 'default',
        '&:hover, &:focus-visible': open ? { bgcolor: alpha(theme.palette.primary.main, 0.05), outline: 'none' } : {},
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <GuestGlyph status={w.vmStatus} dotBorder={dotBorder} />
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Typography variant='body2' sx={{ fontWeight: 600 }} noWrap>{w.vmName ?? `VM ${w.vmid}`}</Typography>
            <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>#{w.vmid}</Typography>
          </Box>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
        {gpus.slice(0, 2).map(a => (
          <GpuChip key={`${a.hostpci}:${a.deviceKey}`} a={a} profile={profileOf(a)} onOpen={onOpen ? () => onOpen(a) : undefined} />
        ))}
        {gpus.length > 2 && <Typography variant='caption' color='text.secondary'>+{gpus.length - 2}</Typography>}
      </Box>
      <StateCell w={w} />
      {/* One line: the node, then the pool of the VM when it has one. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <NodeGlyph online dark={dark} dotBorder={dotBorder} />
        <Typography variant='body2' noWrap sx={{ minWidth: 0, flexShrink: w.pool ? 0 : 1 }}>{showCluster ? `${w.connectionName} · ${w.node}` : w.node}</Typography>
        {w.pool && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, color: 'text.secondary' }}>
            <i className='ri-folder-2-line' style={{ fontSize: '0.9286rem', opacity: 0.8, flexShrink: 0 }} aria-hidden />
            <Typography variant='body2' color='text.secondary' noWrap sx={{ minWidth: 0 }}>{w.pool}</Typography>
          </Box>
        )}
      </Box>
      <Typography variant='body2' color='text.secondary'>{w.uptime ? formatUptime(w.uptime) : '-'}</Typography>
      {running && load ? (
        <Meter testId='gpu-workload-load' pct={load.util} label={`${Math.round(load.util)} %`} />
      ) : (
        <Typography variant='caption' color='text.secondary' title={running ? t('gpu.page.notMeasuredHint') : undefined}>
          {running ? t('gpu.page.notMeasured') : t('gpu.workloads.stopped')}
        </Typography>
      )}
      {running && load ? (
        <Meter
          testId='gpu-workload-memory'
          pct={memoryPct(load.memUsed, load.memTotal)}
          label={`${gib(load.memUsed)} / ${gib(load.memTotal)} ${t('gpu.tiles.gib')}`}
        />
      ) : (
        <span />
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.25 }} onClick={stop} onKeyDown={stop}>
        {actions.canMove && !w.template && (
          <Tooltip title={t('gpu.actions.moveButton')}>
            <IconButton size='small' aria-label={t('gpu.actions.moveButton')} onClick={() => actions.move({ connId: w.connId, node: w.node, vmid: w.vmid, vmName: w.vmName })}>
              <i className='ri-arrow-left-right-line' style={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        )}
        {actions.canAct && releasable.length > 0 && (
          <>
            <Tooltip title={t('gpu.actions.release')}>
              <IconButton
                size='small'
                color='warning'
                aria-label={t('gpu.actions.release')}
                onClick={e => (releasable.length === 1 ? release(releasable[0]) : setMenu(e.currentTarget))}
              >
                <i className='ri-link-unlink' style={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
            <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
              {releasable.map(a => (
                <MenuItem
                  key={a.hostpci}
                  onClick={() => {
                    setMenu(null)
                    release(a)
                  }}
                >
                  {a.hostpci} · {a.deviceName ?? deviceLabel(a)}
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
      </Box>
    </Box>
  )
}

const STATUSES = ['running', 'stopped'] as const

/**
 * The search and status filters of the tab, set in the page bar next to
 * "Refresh": the page holds their state and hands it to the tab.
 */
export function WorkloadFilters({ report, value, onChange }: { report: GpuReport; value: GpuFilterState; onChange: (next: GpuFilterState) => void }) {
  const t = useTranslations()
  const clusters = useMemo(() => [...new Set(workloads(report).map(w => w.connectionName))].sort((a, b) => a.localeCompare(b)), [report])
  return (
    <GpuFilters
      value={value}
      onChange={onChange}
      clusters={clusters}
      statuses={STATUSES.map(s => ({ value: s, label: t(`gpu.page.vmStatus.${s}`) }))}
    />
  )
}

/**
 * The VMs that hold a GPU (#672): what they hold (a vGPU profile or a whole
 * card), where they run, and their live load, from the host for a vGPU (its
 * share of the card, as the vGPU tab shows it) and from inside the VM for a
 * whole card. A row opens the detail of its GPU.
 */
export default function WorkloadsTab({ report, filter = NO_FILTER }: { report: GpuReport; filter?: GpuFilterState }) {
  const t = useTranslations()
  const theme = useTheme()
  const actions = useGpuActions()
  const all = useMemo(() => workloads(report), [report])
  const clusters = useMemo(() => [...new Set(all.map(w => w.connectionName))].sort((a, b) => a.localeCompare(b)), [all])
  const rows = useMemo(
    () =>
      all.filter(w => {
        if (filter.cluster && w.connectionName !== filter.cluster) return false
        if (filter.status === 'running' && w.vmStatus !== 'running') return false
        if (filter.status === 'stopped' && w.vmStatus === 'running') return false
        return matchesSearch(filter.search, w.vmName, w.vmid, w.node, w.connectionName, w.pool, ...w.gpus.map(g => deviceLabel(g)))
      }),
    [all, filter],
  )
  const { rows: page, pagination } = usePaged(rows)
  // The live load is an Enterprise reading; without it the column says "not measured".
  const { hasFeature } = useLicense()
  const latest = useGpuLatest(hasFeature(Features.GPU_MANAGEMENT))
  const vgpus = useMemo(() => latest.data?.vgpus ?? [], [latest.data])
  const catalog = useMemo(() => latest.data?.vgpuTypes ?? [], [latest.data])
  const loads = useMemo(() => {
    const out = new Map<string, VmLoad>()
    const add = (key: string, util: number, used: number, total: number) => {
      const prev = out.get(key)
      out.set(key, { util: Math.max(prev?.util ?? 0, util), memUsed: (prev?.memUsed ?? 0) + used, memTotal: (prev?.memTotal ?? 0) + total })
    }
    // A vGPU is read by the host: its share of the card and its frame buffer.
    const byVgpu = new Set<string>()
    for (const v of vgpus) {
      const key = `${v.connectionId}:${v.node}:${v.vmid}`
      byVgpu.add(key)
      add(key, v.util, v.fbUsed, v.fbTotal)
    }
    for (const g of latest.data?.gpus ?? []) {
      if (!g.vmid) continue
      const key = `${g.connection_id}:${g.node}:${g.vmid}`
      if (!byVgpu.has(key)) add(key, g.util, g.mem_used, g.mem_total)
    }
    return out
  }, [latest.data, vgpus])
  const showCluster = clusters.length > 1 || report.scope === 'infrastructure'

  const devices = useMemo(() => new Map(report.devices.map(d => [d.key, d])), [report])
  const [vgpuOpen, setVgpuOpen] = useState<VgpuDetail | null>(null)
  const [cardOpen, setCardOpen] = useState<{ device: GpuReportDevice; reading: VisibleGpuReading | null } | null>(null)
  const thresholds = latest.data?.thresholds ?? DEFAULT_THRESHOLDS
  const openDetail = (a: GpuReportAllocation) => {
    const device = a.deviceKey ? devices.get(a.deviceKey) : undefined
    if (!device) return
    if (a.mdev) {
      const live: VisibleVgpu | null = vgpus.find(v => v.vmid === a.vmid && v.deviceKey === device.key) ?? null
      setVgpuOpen({
        device,
        allocation: a,
        live,
        profile: live?.profile ?? profileName(a.mdev, device.key, catalog) ?? a.mdev,
        sizeMiB: live?.fbTotal ?? profileMemory(a.mdev, device.key, catalog),
      })
      return
    }
    const reading = (latest.data?.gpus ?? []).find(g => g.deviceKey === device.key && g.vmid === a.vmid) ?? null
    setCardOpen({ device, reading })
  }
  const canOpen = report.scope === 'infrastructure'
  // The profile of a vGPU: the card's catalog, else what the host reports for it.
  const profileOf = (a: GpuReportAllocation): string | null =>
    a.mdev ? (profileName(a.mdev, a.deviceKey, catalog) ?? vgpus.find(v => v.vmid === a.vmid && v.deviceKey === a.deviceKey)?.profile ?? a.mdev) : null

  // The figures of the tab.
  const running = all.filter(w => w.vmStatus === 'running').length
  const vgpuCount = all.reduce((n, w) => n + w.gpus.filter(a => a.kind === 'gpu' && a.mdev).length, 0)
  const wholeCount = all.reduce((n, w) => n + w.gpus.filter(a => a.kind === 'gpu' && !a.mdev && !a.template).length, 0)
  const measured = all.filter(w => w.vmStatus === 'running' && loads.has(w.key)).length
  const kpis = [
    { testId: 'gpu-workloads-vms', icon: 'ri-computer-line', color: theme.palette.primary.main, label: t('gpu.workloads.kpiVms'), value: all.length, sub: t('gpu.workloads.kpiRunning', { count: running }) },
    { testId: 'gpu-workloads-vgpu', icon: 'ri-stack-line', color: theme.palette.info.main, label: t('gpu.workloads.kpiVgpu'), value: vgpuCount, sub: t('gpu.workloads.kpiVgpuSub') },
    { testId: 'gpu-workloads-whole', icon: 'ri-cpu-line', color: theme.palette.mode === 'dark' ? '#8b7cf6' : '#6250d6', label: t('gpu.workloads.kpiWhole'), value: wholeCount, sub: t('gpu.workloads.kpiWholeSub') },
    { testId: 'gpu-workloads-measured', icon: 'ri-pulse-line', color: theme.palette.success.main, label: t('gpu.workloads.kpiMeasured'), value: measured, sub: t('gpu.workloads.kpiMeasuredSub', { count: running }) },
  ]
  const head = { variant: 'caption' as const, color: 'text.secondary', sx: { fontWeight: 600 } }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid='gpu-workloads'>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1.5 }}>
        {kpis.map(k => (
          <KpiFrame key={k.testId} testId={k.testId} color={k.color}>
            <KpiHead icon={k.icon} color={k.color} label={k.label} />
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
              <Typography variant='h5' sx={{ fontWeight: 700 }}>{k.value}</Typography>
              <Typography variant='caption' color='text.secondary'>{k.sub}</Typography>
            </Box>
          </KpiFrame>
        ))}
      </Box>
      <Section title={t('gpu.page.tabs.workloads')} icon='ri-computer-line' right={<Typography variant='caption' color='text.secondary'>{rows.length}</Typography>}>
        {rows.length ? (
          <Box>
            <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: COLUMNS, gap: 1.5, px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
              <Typography {...head}>{t('gpu.colVm')}</Typography>
              <Typography {...head}>{t('gpu.workloads.colGpu')}</Typography>
              <Typography {...head}>{t('gpu.workloads.colState')}</Typography>
              <Typography {...head}>{t('gpu.workloads.colPlace')}</Typography>
              <Typography {...head}>{t('gpu.page.colUptime')}</Typography>
              <Tooltip title={t('gpu.workloads.colLoadHint')} disableInteractive>
                <Typography {...head} sx={{ ...head.sx, cursor: 'help', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {t('gpu.page.colLoad')} <i className='ri-information-line' aria-hidden />
                </Typography>
              </Tooltip>
              <Typography {...head}>{t('gpu.workloads.colMemory')}</Typography>
              <span />
            </Box>
            {page.map(w => (
              <WorkloadRow key={w.key} w={w} showCluster={showCluster} load={loads.get(w.key)} profileOf={profileOf} onOpen={canOpen ? openDetail : null} />
            ))}
            <Pager count={rows.length} pager={pagination} />
          </Box>
        ) : (
          <Typography variant='body2' color='text.secondary' sx={{ px: 2, py: 3, textAlign: 'center' }}>
            {all.length ? t('gpu.page.noMatch') : report.scope === 'tenant' ? t('gpu.emptyTenant') : t('gpu.emptyAllocations')}
          </Typography>
        )}
      </Section>
      <VgpuDetailDialog
        detail={vgpuOpen}
        thresholds={thresholds}
        onClose={() => setVgpuOpen(null)}
        onRelease={
          actions.canAct && vgpuOpen?.allocation.hostpci && vgpuOpen.allocation.vmid
            ? () => {
                const a = vgpuOpen.allocation
                setVgpuOpen(null)
                actions.release({ connId: a.connId, node: a.node, vmid: a.vmid as string, vmName: a.vmName, hostpci: a.hostpci as string, deviceName: a.deviceName, vmStatus: a.vmStatus })
              }
            : undefined
        }
      />
      <GpuDetailDialog device={cardOpen?.device ?? null} reading={cardOpen?.reading ?? null} thresholds={thresholds} catalog={catalog} onClose={() => setCardOpen(null)} />
    </Box>
  )
}
