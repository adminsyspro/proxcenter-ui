'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import {
  Box, Button, Chip, Collapse, Divider, IconButton, Paper, Stack, TablePagination, Tooltip, Typography,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import GpuGauge, { gaugeTone } from '@/components/gpu/GpuGauge'
import type { MyGpu, MyGpuVm, MyGpuView } from '@/lib/gpu/vdcView'
import { pageOf } from '@/lib/paging'

import MyGpuAttachDialog from './MyGpuAttachDialog'
import MyGpuHours from './MyGpuHours'
import MyGpuReleaseDialog from './MyGpuReleaseDialog'
import { entryLabel, gpuErrorMessage, gpuKindLabel, MIB_PER_GIB, OneLine } from './myGpuShared'

interface Props {
  vdcId: string
}

type Row = { vm: MyGpuVm; gpu: MyGpu }

const REFRESH_MS = 30_000
const PAGE_SIZE = 10

const gib = (mib: number) => String(Math.round((mib / MIB_PER_GIB) * 10) / 10)

/**
 * The GPUs of the tenant's vDC: the contingent per line, the VMs that hold a
 * GPU with their load, attach and release, and the hours of the month. Renders
 * nothing when the vDC has no GPU contingent, the license lacks the feature or
 * the caller has no right to it (404 or 403).
 */
export default function MyGpuCard({ vdcId }: Props) {
  const t = useTranslations()
  const locale = useLocale()
  const theme = useTheme()
  const [view, setView] = useState<MyGpuView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [attaching, setAttaching] = useState(false)
  const [releasing, setReleasing] = useState<Row | null>(null)
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [inView, setInView] = useState(false)
  const [tabVisible, setTabVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible')
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    setRefreshing(true)
    try {
      const r = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/gpu`, { cache: 'no-store' })
      if (mine !== seq.current) return
      if (r.status === 404 || r.status === 403) {
        setHidden(true)
        return
      }
      const json = await r.json().catch(() => null)
      if (mine !== seq.current) return
      if (!r.ok || !json?.data) {
        setError(gpuErrorMessage(t, json?.error ?? 'unavailable'))
        return
      }
      setView(json.data)
      setError(null)
    } catch {
      if (mine === seq.current) setError(gpuErrorMessage(t, 'unavailable'))
    } finally {
      if (mine === seq.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
    // t is stable per locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vdcId])

  const reload = useCallback(() => {
    setTick((n) => n + 1)
    void load()
  }, [load])

  useEffect(() => {
    void load()
    return () => { seq.current++ }
  }, [load])

  // Back on the tab: read again, like the page does.
  useEffect(() => {
    const onVisible = () => {
      const visible = document.visibilityState === 'visible'
      setTabVisible(visible)
      if (visible) reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload])

  useEffect(() => {
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1]
      if (last) setInView(last.isIntersecting)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [el])

  // The timer runs only while the card is on screen and the tab is in front.
  useEffect(() => {
    if (hidden || !inView || !tabVisible) return
    const id = setInterval(() => { void load() }, REFRESH_MS)
    return () => clearInterval(id)
  }, [hidden, inView, tabVisible, load])

  // Nothing until the first answer: a vDC without contingent or license never flashes a card.
  if (hidden || loading) return null

  const rows: Row[] = (view?.vms ?? []).flatMap((vm) => vm.gpus.map((gpu) => ({ vm, gpu })))
  const { rows: pageRows, page: current } = pageOf(rows, page, PAGE_SIZE)
  const rowKey = (r: Row) => `${r.vm.vmid}|${r.gpu.hostpci}`
  const toggle = (k: string) => setOpen((prev) => {
    const next = new Set(prev)
    if (!next.delete(k)) next.add(k)
    return next
  })
  const headerBg = alpha(theme.palette.primary.main, 0.1)

  return (
    <Paper variant="outlined" sx={{ p: 2 }} ref={setEl}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
        <Box sx={{ p: 0.75, borderRadius: 1.5, bgcolor: headerBg, color: 'primary.main', display: 'flex' }}>
          <i className="ri-cpu-line" style={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={700} noWrap>{t('myVdc.gpu.title')}</Typography>
          <OneLine variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t('myVdc.gpu.subtitle')}</OneLine>
        </Box>
        <Button
          size="small"
          variant="contained"
          startIcon={<i className="ri-add-line" />}
          disabled={!view || view.entries.length === 0}
          onClick={() => setAttaching(true)}
          sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {t('myVdc.gpu.attach')}
        </Button>
        <Tooltip title={t('common.refresh')}>
          <span>
            <IconButton size="small" aria-label={t('common.refresh')} onClick={reload} disabled={refreshing}>
              <i className="ri-refresh-line" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error && <OneLine variant="caption" color="error.main">{error}</OneLine>}

      {view && (
        <Stack spacing={2}>
          {!view.measured && <OneLine variant="caption" color="text.secondary">{t('myVdc.gpu.unmeasuredNote')}</OneLine>}

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{t('myVdc.gpu.quotaTitle')}</Typography>
            {view.entries.length === 0 ? (
              <Typography variant="caption" color="text.secondary">{t('myVdc.gpu.quotaEmpty')}</Typography>
            ) : (
              <Stack spacing={0.75}>
                {view.entries.map((e) => {
                  const pct = e.count > 0 ? Math.min(100, Math.round((e.used / e.count) * 100)) : 0
                  return (
                    <Stack key={e.id} direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
                      <i className="ri-cpu-line" style={{ fontSize: 16, flexShrink: 0, opacity: 0.7 }} />
                      <OneLine color={e.overCommitted ? 'error.main' : undefined} sx={{ flex: '1 1 200px' }}>{entryLabel(t, e)}</OneLine>
                      {e.overCommitted && (
                        <Chip size="small" color="error" variant="outlined" label={t('myVdc.gpu.overQuota')} sx={{ height: 20, flexShrink: 0 }} />
                      )}
                      <Box sx={{ width: { xs: 70, sm: 140 }, flexShrink: 0 }}><GpuGauge pct={pct} /></Box>
                    </Stack>
                  )
                })}
              </Stack>
            )}
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{t('myVdc.gpu.vmsTitle')}</Typography>
            {rows.length === 0 ? (
              <Typography variant="caption" color="text.secondary">{t('myVdc.gpu.vmsEmpty')}</Typography>
            ) : (
              <>
                {pageRows.map((r) => {
                  const k = rowKey(r)
                  const expanded = open.has(k)
                  const { gpu, vm } = r
                  return (
                    <Box key={k} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minHeight: 38, minWidth: 0 }}>
                        <StatusIcon type="vm" status={vm.status} size={16} />
                        <OneLine sx={{ flex: '1 1 130px', fontWeight: 500 }}>{vm.name}</OneLine>
                        <OneLine color="text.secondary" sx={{ flex: '1 1 130px' }}>{gpuKindLabel(t, gpu)}</OneLine>
                        <Box sx={{ width: { xs: 90, sm: 130 }, flexShrink: 0 }}>
                          {gpu.load ? (
                            <Stack direction="row" alignItems="center" spacing={0.75}>
                              <Box sx={{ flex: 1, minWidth: 0 }}><GpuGauge pct={gpu.load.util} /></Box>
                              <Typography variant="caption" noWrap color={gaugeTone(gpu.load.util, 90)} sx={{ minWidth: 34, textAlign: 'right', fontWeight: 600 }}>
                                {t('myVdc.gpu.load', { value: Math.round(gpu.load.util) })}
                              </Typography>
                            </Stack>
                          ) : (
                            <Typography variant="caption" color="text.secondary" noWrap>{t('myVdc.gpu.notMeasured')}</Typography>
                          )}
                        </Box>
                        {gpu.kind === 'vgpu' && gpu.load?.fbUsed != null && gpu.load.fbTotal != null && (
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ width: 84, flexShrink: 0, display: { xs: 'none', md: 'block' } }}>
                            {t('myVdc.gpu.memory', { used: gib(gpu.load.fbUsed), total: gib(gpu.load.fbTotal) })}
                          </Typography>
                        )}
                        {gpu.pendingStart && (
                          <Chip size="small" color="warning" variant="outlined" label={t('myVdc.gpu.nextStart')} sx={{ height: 20, flexShrink: 0 }} />
                        )}
                        {gpu.pendingRemoval ? (
                          <Chip size="small" color="warning" variant="outlined" label={t('myVdc.gpu.pendingRemoval')} sx={{ height: 20, flexShrink: 0 }} />
                        ) : (
                          <Button size="small" color="warning" onClick={() => setReleasing(r)} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                            {t('myVdc.gpu.release')}
                          </Button>
                        )}
                        <IconButton
                          size="small"
                          aria-expanded={expanded}
                          aria-label={t(expanded ? 'myVdc.gpu.hideDetails' : 'myVdc.gpu.showDetails')}
                          onClick={() => toggle(k)}
                        >
                          <i className={expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
                        </IconButton>
                      </Stack>
                      <Collapse in={expanded} unmountOnExit>
                        <Stack spacing={0.25} sx={{ pl: 4, pb: 1 }}>
                          {[
                            [t('myVdc.gpu.detailLicense'), gpu.licensed === null ? t('myVdc.gpu.licenseUnknown') : t(gpu.licensed ? 'myVdc.gpu.licenseYes' : 'myVdc.gpu.licenseNo')],
                            [t('myVdc.gpu.detailAt'), gpu.load ? new Date(gpu.load.at).toLocaleString(locale) : t('myVdc.gpu.notMeasured')],
                            [t('myVdc.gpu.detailSlot'), gpu.hostpci],
                          ].map(([label, value]) => (
                            <Stack key={label} direction="row" spacing={1.5}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', width: 120, flexShrink: 0 }}>{label}</Typography>
                              <Typography variant="caption" sx={{ display: 'block' }}>{value}</Typography>
                            </Stack>
                          ))}
                        </Stack>
                      </Collapse>
                    </Box>
                  )
                })}
                {rows.length > PAGE_SIZE && (
                  <TablePagination
                    component="div"
                    count={rows.length}
                    page={current}
                    onPageChange={(_, p) => setPage(p)}
                    rowsPerPage={PAGE_SIZE}
                    rowsPerPageOptions={[PAGE_SIZE]}
                    labelDisplayedRows={({ from, to, count }) => t('myVdc.gpu.displayedRows', { from, to, count })}
                    sx={{ '& .MuiTablePagination-toolbar': { minHeight: 40 } }}
                  />
                )}
              </>
            )}
          </Box>

          <Divider />

          <MyGpuHours vdcId={vdcId} tick={tick} vmStatus={Object.fromEntries((view?.vms ?? []).map((vm) => [vm.vmid, vm.status]))} />
        </Stack>
      )}

      {attaching && view && (
        <MyGpuAttachDialog
          vdcId={vdcId}
          entries={view.entries}
          onClose={() => setAttaching(false)}
          onDone={() => { setAttaching(false); reload() }}
        />
      )}
      {releasing && (
        <MyGpuReleaseDialog
          vdcId={vdcId}
          vmid={releasing.vm.vmid}
          vmName={releasing.vm.name}
          vmStatus={releasing.vm.status}
          gpuLabel={gpuKindLabel(t, releasing.gpu)}
          hostpci={releasing.gpu.hostpci}
          onClose={() => setReleasing(null)}
          onDone={() => { setReleasing(null); reload() }}
        />
      )}
    </Paper>
  )
}
