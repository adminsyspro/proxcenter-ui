'use client'

import React, { useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  FormControlLabel,
  IconButton,
  Switch,
  TablePagination,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'

import type { GpuReport, GpuReportAllocation, GpuReportDevice } from '@/lib/gpu/report'
import type { GpuCapacity } from '@/lib/gpu/inventory'


import { useGpuReport } from './useGpuReport'
import GpuGauge from '@/components/gpu/GpuGauge'

const GUEST_STATUS_COLORS: Record<string, string> = { running: '#4caf50', stopped: '#f44336', paused: '#ff9800', suspended: '#ff9800' }
const guestStatusColor = (status: string | null) => GUEST_STATUS_COLORS[status || ''] || '#616161'
export const STATUS_COLORS = { free: '#4caf50', allocated: '#ff9800', inUse: '#2196f3', console: '#9e9e9e' }
const PAGE_SIZES = [20, 50, 100]

/**
 * Value of the GPU tab in the cluster and node views of the inventory. Those
 * tab bars index their tabs by position; an explicit value out of that range
 * keeps the GPU tab from shifting any of them.
 */
export const GPU_TAB_VALUE = 100

type DeviceStatus = keyof typeof STATUS_COLORS

export function deviceStatus(d: Pick<GpuReportDevice, 'kind' | 'vms'>): DeviceStatus {
  if (d.kind === 'console') return 'console'
  if (d.vms.some(v => v.vmStatus === 'running')) return 'inUse'
  return d.vms.length ? 'allocated' : 'free'
}

/** "NVIDIA Corporation GA102 [GeForce RTX 3090]", or the PCI IDs when PVE names nothing. */
export function deviceLabel(d: { vendorName: string | null; deviceName: string | null; vendorId: string | null; deviceId: string | null }): string {
  const name = [d.vendorName, d.deviceName].filter(Boolean).join(' ')
  if (name) return name
  const ids = [d.vendorId, d.deviceId].filter(Boolean).map(s => String(s).replace(/^0x/, ''))
  return ids.length ? ids.join(':') : '?'
}

export function GuestGlyph({ status, dotBorder }: { status: string | null; dotBorder: string }) {
  return (
    <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <i className='ri-computer-line' style={{ fontSize: '0.9286rem', opacity: 0.8 }} />
      <Box sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: guestStatusColor(status), border: `1px solid ${dotBorder}` }} />
    </Box>
  )
}

export function NodeGlyph({ online, dark, dotBorder }: { online: boolean | null; dark: boolean; dotBorder: string }) {
  const color = online === null ? '#9e9e9e' : online ? '#4caf50' : '#f44336'
  return (
    <Box component='span' sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
      <img src={dark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={14} height={14} style={{ opacity: 0.8 }} />
      <Box component='span' sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: color, border: `1px solid ${dotBorder}` }} />
    </Box>
  )
}

export function DeviceGlyph({ kind, status, dotBorder }: { kind: 'gpu' | 'console'; status: DeviceStatus; dotBorder: string }) {
  return (
    <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <i className={kind === 'console' ? 'ri-tv-2-line' : 'ri-cpu-line'} style={{ fontSize: '0.9286rem', opacity: 0.8 }} />
      <Box sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: STATUS_COLORS[status], border: `1px solid ${dotBorder}` }} />
    </Box>
  )
}

export function Section({ title, icon, right, children }: { title: string; icon: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
        <i className={icon} style={{ fontSize: 16 }} />
        <Typography variant='subtitle2' sx={{ fontWeight: 700, flex: 1 }}>{title}</Typography>
        {right}
      </Box>
      {children}
    </Box>
  )
}

export function CapacityTiles({ capacity }: { capacity: GpuCapacity }) {
  const t = useTranslations()
  const tiles: Array<{ key: string; label: string; value: number; color?: string }> = [
    { key: 'total', label: t('gpu.total'), value: capacity.total },
    { key: 'allocated', label: t('gpu.allocated'), value: capacity.allocated, color: STATUS_COLORS.allocated },
    { key: 'free', label: t('gpu.free'), value: capacity.free, color: STATUS_COLORS.free },
    { key: 'inUse', label: t('gpu.inUse'), value: capacity.inUse, color: STATUS_COLORS.inUse },
  ]
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1.5 }}>
      {tiles.map(tile => (
        <Box key={tile.key} data-testid={`gpu-tile-${tile.key}`} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, px: 2, py: 1.25 }}>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{tile.label}</Typography>
          <Typography variant='h5' sx={{ fontWeight: 700, color: tile.color }}>{tile.value}</Typography>
        </Box>
      ))}
    </Box>
  )
}

export function CapacityBar({ capacity }: { capacity: GpuCapacity }) {
  const pct = capacity.total ? (capacity.allocated / capacity.total) * 100 : 0
  return <GpuGauge pct={pct} height={6} />
}

// Name (rest), total, allocated, free, in use, bar.
const CAPACITY_COLUMNS = 'minmax(0, 1fr) 70px 80px 60px 70px 140px'

export type CapacityRow = { key: string; label: string; glyph: React.ReactNode; capacity: GpuCapacity | null; note?: string | null }

export function CapacityTable({ rows, nameHeader }: { rows: CapacityRow[]; nameHeader: string }) {
  const t = useTranslations()
  const head = { variant: 'caption' as const, color: 'text.secondary', sx: { fontWeight: 600 } }
  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: CAPACITY_COLUMNS, gap: 1.5, px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <Typography {...head}>{nameHeader}</Typography>
        <Typography {...head}>{t('gpu.total')}</Typography>
        <Typography {...head}>{t('gpu.allocated')}</Typography>
        <Typography {...head}>{t('gpu.free')}</Typography>
        <Typography {...head}>{t('gpu.inUse')}</Typography>
        <span />
      </Box>
      {rows.map(row => (
        <Box key={row.key} data-testid='gpu-capacity-row' sx={{ display: 'grid', gridTemplateColumns: CAPACITY_COLUMNS, gap: 1.5, alignItems: 'center', px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            {row.glyph}
            <Typography variant='body2' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</Typography>
            {row.note && <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>{row.note}</Typography>}
          </Box>
          <Typography variant='body2'>{row.capacity?.total ?? '-'}</Typography>
          <Typography variant='body2'>{row.capacity?.allocated ?? '-'}</Typography>
          <Typography variant='body2'>{row.capacity?.free ?? '-'}</Typography>
          <Typography variant='body2'>{row.capacity?.inUse ?? '-'}</Typography>
          {row.capacity ? <CapacityBar capacity={row.capacity} /> : <span />}
        </Box>
      ))}
    </Box>
  )
}

export function usePaged<T>(items: T[]) {
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(PAGE_SIZES[0])
  const maxPage = Math.max(0, Math.ceil(items.length / size) - 1)
  const current = Math.min(page, maxPage)
  return {
    rows: items.slice(current * size, current * size + size),
    pagination: items.length > PAGE_SIZES[0] ? { page: current, size, setPage, setSize } : null,
  }
}

export function Pager({ count, pager }: { count: number; pager: ReturnType<typeof usePaged>['pagination'] }) {
  const t = useTranslations()
  if (!pager) return null
  return (
    <TablePagination
      component='div'
      count={count}
      page={pager.page}
      rowsPerPage={pager.size}
      rowsPerPageOptions={PAGE_SIZES}
      onPageChange={(_e, p) => pager.setPage(p)}
      onRowsPerPageChange={e => { pager.setSize(Number(e.target.value)); pager.setPage(0) }}
      labelRowsPerPage={t('common.rowsPerPage')}
    />
  )
}

function DetailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 1.5, py: 0.25 }}>
      <Typography variant='caption' color='text.secondary'>{label}</Typography>
      <Typography variant='body2' component='div' sx={{ whiteSpace: 'normal' }}>{children}</Typography>
    </Box>
  )
}

/** Live readings of the GPU page (Enterprise): replace the PCI address column by the load columns. */
function DeviceRow({ device, showNode, showCluster }: { device: GpuReportDevice; showNode: boolean; showCluster: boolean }) {
  const t = useTranslations()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const [open, setOpen] = useState(false)
  const status = deviceStatus(device)
  const columns = deviceColumns(showNode, showCluster)
  const first = device.vms[0]
  const iommu =
    device.iommuGroup === null
      ? t('gpu.iommuNone')
      : device.iommuIsolated
        ? t('gpu.iommuIsolated', { group: device.iommuGroup })
        : t('gpu.iommuShared', { group: device.iommuGroup })

  return (
    <Box data-testid='gpu-device-row' sx={{ borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: columns, gap: 1.5, alignItems: 'center', px: 1, py: 0.5 }}>
        <IconButton size='small' onClick={() => setOpen(o => !o)} aria-label={t('gpu.details')} aria-expanded={open}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 18 }} />
        </IconButton>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <DeviceGlyph kind={device.kind} status={status} dotBorder={dotBorder} />
          <Typography variant='body2' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deviceLabel(device)}
          </Typography>
        </Box>
        {showCluster && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <i className='ri-server-line' style={{ fontSize: '0.9286rem', flexShrink: 0 }} />
            <Typography variant='body2' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.connectionName}</Typography>
          </Box>
        )}
        {showNode && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <NodeGlyph online dark={dark} dotBorder={dotBorder} />
            <Typography variant='body2' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.node}</Typography>
          </Box>
        )}
        <Typography variant='body2' color='text.secondary'>{device.id}</Typography>
        <Typography variant='body2' sx={{ color: STATUS_COLORS[status], fontWeight: 600 }}>{t(`gpu.status.${status}`)}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          {first ? (
            <>
              <GuestGlyph status={first.vmStatus} dotBorder={dotBorder} />
              <Typography variant='body2' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {first.hidden ? t('gpu.hiddenVm') : first.vmName}
              </Typography>
              {!first.hidden && <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>#{first.vmid}</Typography>}
              {device.vms.length > 1 && <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>+{device.vms.length - 1}</Typography>}
            </>
          ) : (
            <Typography variant='body2' color='text.secondary'>-</Typography>
          )}
        </Box>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 6, pb: 1.5, pt: 0.5 }}>
          <DetailLine label={t('gpu.detailIds')}>{[device.vendorId, device.deviceId].filter(Boolean).map(s => String(s).replace(/^0x/, '')).join(':') || '-'}</DetailLine>
          {device.subsystemName && <DetailLine label={t('gpu.detailSubsystem')}>{device.subsystemName}</DetailLine>}
          <DetailLine label={t('gpu.detailFunctions')}>{device.functions.join(', ')}</DetailLine>
          <DetailLine label={t('gpu.detailIommu')}>{iommu}</DetailLine>
          <DetailLine label={t('gpu.detailMdev')}>{device.mdev ? t('gpu.mdevCapable') : t('gpu.mdevNo')}</DetailLine>
          <DetailLine label={t('gpu.detailMappings')}>{device.mappings.length ? device.mappings.join(', ') : t('gpu.none')}</DetailLine>
          {device.kind === 'console' && (
            <DetailLine label={t('gpu.detailKind')}>{t(device.consoleReason === 'emulated' ? 'gpu.consoleReasonEmulated' : 'gpu.consoleReasonVendor')}</DetailLine>
          )}
          <DetailLine label={t('gpu.colVms')}>
            {device.vms.length === 0
              ? t('gpu.none')
              : device.vms.map((v, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <GuestGlyph status={v.vmStatus} dotBorder={dotBorder} />
                    <span>{v.hidden ? t('gpu.hiddenVm') : `${v.vmName} #${v.vmid}${v.template ? ` (${t('gpu.template')})` : ''}`}</span>
                    {v.hostpci && <Typography variant='caption' color='text.secondary'>{v.hostpci}</Typography>}
                    {v.mdev && <Typography variant='caption' color='text.secondary'>{t('gpu.mdevType', { type: v.mdev })}</Typography>}
                  </Box>
                ))}
          </DetailLine>
        </Box>
      </Collapse>
    </Box>
  )
}

function deviceColumns(showNode: boolean, showCluster: boolean) {
  // Chevron, device (rest), [cluster], [node], PCI address, status, VMs.
  return ['32px', 'minmax(0, 1fr)', showCluster ? '150px' : '', showNode ? '130px' : '', '120px', '90px', '220px'].filter(Boolean).join(' ')
}

export function DeviceList({ devices, showNode, showCluster }: { devices: GpuReportDevice[]; showNode: boolean; showCluster: boolean }) {
  const t = useTranslations()
  const { rows, pagination } = usePaged(devices)
  const head = { variant: 'caption' as const, color: 'text.secondary', sx: { fontWeight: 600 } }
  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: deviceColumns(showNode, showCluster), gap: 1.5, px: 1, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <span />
        <Typography {...head}>{t('gpu.colDevice')}</Typography>
        {showCluster && <Typography {...head}>{t('gpu.colCluster')}</Typography>}
        {showNode && <Typography {...head}>{t('gpu.colNode')}</Typography>}
        <Typography {...head}>{t('gpu.colAddress')}</Typography>
        <Typography {...head}>{t('gpu.colStatus')}</Typography>
        <Typography {...head}>{t('gpu.colVms')}</Typography>
      </Box>
      {rows.map(d => <DeviceRow key={d.key} device={d} showNode={showNode} showCluster={showCluster} />)}
      <Pager count={devices.length} pager={pagination} />
    </Box>
  )
}

function allocationColumns(showNode: boolean, showCluster: boolean) {
  // VM, [cluster], [node], device (rest), slot, assigned by.
  return ['200px', showCluster ? '140px' : '', showNode ? '100px' : '', 'minmax(0, 1fr)', '96px', '160px'].filter(Boolean).join(' ')
}

export function AllocationList({ allocations, showNode, showCluster }: { allocations: GpuReportAllocation[]; showNode: boolean; showCluster: boolean }) {
  const t = useTranslations()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const { rows, pagination } = usePaged(allocations)
  const columns = allocationColumns(showNode, showCluster)
  const head = { variant: 'caption' as const, color: 'text.secondary', sx: { fontWeight: 600 } }
  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: columns, gap: 1.5, px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <Typography {...head}>{t('gpu.colVm')}</Typography>
        {showCluster && <Typography {...head}>{t('gpu.colCluster')}</Typography>}
        {showNode && <Typography {...head}>{t('gpu.colNode')}</Typography>}
        <Typography {...head}>{t('gpu.colDevice')}</Typography>
        <Typography {...head}>{t('gpu.colHostpci')}</Typography>
        <Typography {...head}>{t('gpu.colVia')}</Typography>
      </Box>
      {rows.map((a, i) => (
        <Box key={`${a.deviceKey ?? ''}:${a.vmid ?? i}:${a.hostpci ?? i}`} data-testid='gpu-allocation-row' sx={{ display: 'grid', gridTemplateColumns: columns, gap: 1.5, alignItems: 'center', px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <GuestGlyph status={a.vmStatus} dotBorder={dotBorder} />
            <Typography variant='body2' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.hidden ? t('gpu.hiddenVm') : a.vmName}
            </Typography>
            {!a.hidden && <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>#{a.vmid}</Typography>}
          </Box>
          {showCluster && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
              <i className='ri-server-line' style={{ fontSize: '0.9286rem', flexShrink: 0 }} />
              <Typography variant='body2' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.connectionName}</Typography>
            </Box>
          )}
          {showNode && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <NodeGlyph online dark={dark} dotBorder={dotBorder} />
              <Typography variant='body2' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.node}</Typography>
            </Box>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <i className={a.kind === 'console' ? 'ri-tv-2-line' : 'ri-cpu-line'} style={{ fontSize: '0.9286rem', opacity: 0.8, flexShrink: 0 }} />
            <Typography variant='body2' title={`${deviceLabel(a)}${a.pciId ? ` (${a.pciId})` : ''}`} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.deviceName || deviceLabel(a)}{a.pciId ? ` (${a.pciId})` : ''}
            </Typography>
            {a.mdev && <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>{t('gpu.mdevType', { type: a.mdev })}</Typography>}
          </Box>
          <Typography variant='body2' color='text.secondary'>{a.hostpci ?? '-'}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <i className={a.via === 'mapping' ? 'ri-links-line' : 'ri-route-line'} style={{ fontSize: '0.9286rem', flexShrink: 0, opacity: 0.8 }} />
            <Typography variant='body2' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.via === 'mapping' ? (a.mapping ? t('gpu.viaMapping', { name: a.mapping }) : t('gpu.viaMappingAnonymous')) : t('gpu.viaAddress')}
            </Typography>
            {a.pooled && (
              <Tooltip title={t('gpu.pooledHint')}>
                <i className='ri-question-line' style={{ fontSize: '0.9286rem', cursor: 'help', flexShrink: 0 }} />
              </Tooltip>
            )}
          </Box>
        </Box>
      ))}
      <Pager count={allocations.length} pager={pagination} />
    </Box>
  )
}

/** The capacity rows of a report: per node inside one cluster, per cluster otherwise. */
export function capacityRows(report: GpuReport, perNode: boolean, dark: boolean, dotBorder: string, t: (k: string) => string): CapacityRow[] {
  if (perNode) {
    return report.nodes.map(n => ({
      key: `${n.connId}:${n.node}`,
      label: n.node,
      glyph: <NodeGlyph online={n.online} dark={dark} dotBorder={dotBorder} />,
      capacity: n.online && !n.error ? n.capacity : null,
      note: !n.online ? t('gpu.nodeOffline') : n.error ? t('gpu.nodeError') : null,
    }))
  }
  return report.connections.map(c => ({
    key: c.id,
    label: c.name,
    glyph: <i className='ri-server-line' style={{ fontSize: '0.9286rem', flexShrink: 0 }} />,
    capacity: c.error ? null : c.capacity,
    note: c.error ? t('gpu.connectionError') : null,
  }))
}

/**
 * GPU inventory, allocation map and capacity (#672). Without `connId` it
 * covers every connected cluster, with it one cluster (per-node capacity),
 * with `node` too a single node. A vDC tenant gets the GPUs of its own VMs only.
 */
export default function GpuInventoryPanel({ connId, node }: { connId?: string | null; node?: string | null }) {
  const t = useTranslations()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const { report, loading, error, refresh } = useGpuReport(connId, node)
  const [showConsoles, setShowConsoles] = useState(false)

  const consoleCount = report?.devices.filter(d => d.kind === 'console').length ?? 0
  const devices = useMemo(
    () => (report?.devices ?? []).filter(d => showConsoles || d.kind !== 'console'),
    [report, showConsoles],
  )
  const allocations = useMemo(
    () => (report?.allocations ?? []).filter(a => report?.scope === 'tenant' || showConsoles || a.kind !== 'console'),
    [report, showConsoles],
  )

  const showCluster = !connId
  const showNode = !node
  const refreshButton = (
    <Button size='small' variant='outlined' onClick={refresh} disabled={loading} startIcon={loading ? <CircularProgress size={14} /> : <i className='ri-refresh-line' />}>
      {t('gpu.refresh')}
    </Button>
  )

  if (!report) {
    return (
      <Box sx={{ p: 2 }}>
        {error ? <Alert severity='error' action={refreshButton}>{t('gpu.loadError')}: {error}</Alert> : <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={28} /></Box>}
      </Box>
    )
  }

  if (report.scope === 'tenant') {
    return (
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }} data-testid='gpu-panel' data-scope='tenant'>
        {error && <Alert severity='error'>{t('gpu.loadError')}: {error}</Alert>}
        <Section title={t('gpu.tenantTitle')} icon='ri-cpu-line' right={refreshButton}>
          {allocations.length ? (
            <AllocationList allocations={allocations} showNode={showNode} showCluster={showCluster} />
          ) : (
            <Typography variant='body2' color='text.secondary' sx={{ px: 2, py: 3, textAlign: 'center' }}>{t('gpu.emptyTenant')}</Typography>
          )}
        </Section>
      </Box>
    )
  }

  const perNode = !!connId && !node
  const hiddenConsoles = showConsoles ? 0 : consoleCount

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }} data-testid='gpu-panel' data-scope='infrastructure'>
      {error && <Alert severity='error'>{t('gpu.loadError')}: {error}</Alert>}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 320 }}>{report.capacity && <CapacityTiles capacity={report.capacity} />}</Box>
        <FormControlLabel
          control={<Switch size='small' checked={showConsoles} onChange={e => setShowConsoles(e.target.checked)} />}
          label={<Typography variant='body2'>{t('gpu.showConsoles', { count: consoleCount })}</Typography>}
        />
        {refreshButton}
      </Box>

      {!node && (
        <Section title={perNode ? t('gpu.capacityPerNode') : t('gpu.capacityPerCluster')} icon='ri-bar-chart-horizontal-line'>
          <CapacityTable rows={capacityRows(report, perNode, dark, dotBorder, t)} nameHeader={perNode ? t('gpu.colNode') : t('gpu.colCluster')} />
        </Section>
      )}

      <Section title={t('gpu.devices')} icon='ri-cpu-line'>
        {devices.length ? (
          <DeviceList devices={devices} showNode={showNode} showCluster={showCluster} />
        ) : (
          <Typography variant='body2' color='text.secondary' sx={{ px: 2, py: 3, textAlign: 'center' }}>
            {t('gpu.emptyInfra')}{hiddenConsoles ? ` ${t('gpu.emptyConsolesHidden', { count: hiddenConsoles })}` : ''}
          </Typography>
        )}
      </Section>

      <Section title={t('gpu.allocations')} icon='ri-links-line'>
        {allocations.length ? (
          <AllocationList allocations={allocations} showNode={showNode} showCluster={showCluster} />
        ) : (
          <Typography variant='body2' color='text.secondary' sx={{ px: 2, py: 3, textAlign: 'center' }}>{t('gpu.emptyAllocations')}</Typography>
        )}
      </Section>
    </Box>
  )
}
