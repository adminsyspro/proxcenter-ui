'use client'

import { useEffect, useMemo, useState } from 'react'

import { useLocale, useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Stack,
  TablePagination,
  Tooltip,
  Typography,
} from '@mui/material'

import ImagePreviewDialog from '@/components/ui/ImagePreviewDialog'
import { PAGE_SIZES, STICKY_PAGER_SX } from '@/components/ui/PagedRows'
import { useRBAC } from '@/contexts/RBACContext'
import { useToast } from '@/contexts/ToastContext'
import { useSWRFetch } from '@/hooks/useSWRFetch'
import {
  canCancel,
  canExportEvidence,
  canRetryCleanup,
  cleanupGlyph,
  drillDurationSec,
  drillIcon,
  drillOrigin,
  drillsPollIntervalMs,
  filenameFromDisposition,
  formatDuration,
  isDrillActive,
  orderedStages,
  resultChip,
  stageDurationSec,
  stageLabelKey,
  stageLook,
  statusChip,
} from '@/lib/backups/restoreDrills/display'
import { utc } from '@/lib/backups/restoreDrills/evidencePdf'
import type { Drill, DrillEvent, Schedule } from '@/lib/backups/restoreDrills/types'
import { formatDateTime } from '@/lib/i18n/date'

import type { PbsConnection } from './RestoreDrillScheduleDialog'
import RestoreDrillSchedules from './RestoreDrillSchedules'
import RestoreDrillSettingsDialog from './RestoreDrillSettingsDialog'
import { DetailField, EventLog, spinSx } from './shared'

const P = 'backups.restoreDrills'
const LIST_URL = '/api/v1/backups/restore-drills'

// Glyph, source, origin, restore point, target, duration, result, actions, chevron.
const ROW_COLUMNS = '20px minmax(140px, 1.2fr) minmax(90px, 0.7fr) 150px minmax(160px, 1fr) 72px minmax(230px, 1.1fr) 64px 100px 28px'

interface Connection { id: string; name?: string }

interface RestoreDrillsTabProps {
  pveConnections?: Connection[]
  /** Sources a schedule can read from. */
  pbsConnections?: PbsConnection[]
  /** Changes when a drill was started elsewhere on the page: reload now. */
  refreshKey?: number
}

export default function RestoreDrillsTab({ pveConnections = [], pbsConnections = [], refreshKey = 0 }: RestoreDrillsTabProps) {
  const t = useTranslations()
  const rbac = useRBAC() as { loading: boolean; hasPermission: (p: string) => boolean }
  const canRestore = !rbac.loading && rbac.hasPermission('backup.restore')
  const canEditSettings = !rbac.loading && rbac.hasPermission('admin.settings')

  // A number, not a function: SWR reads a function once at mount, before any
  // data, and the first poll would wait for the idle interval.
  const [refreshInterval, setRefreshInterval] = useState(() => drillsPollIntervalMs(null))
  // Paged by the orchestrator, active drills first: every row of the history
  // stays reachable, the poll refreshes the page on screen.
  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(PAGE_SIZES[0])
  // The drills of one schedule only, picked from its details.
  const [scheduleFilter, setScheduleFilter] = useState<Pick<Schedule, 'id' | 'name'> | null>(null)
  const filterParam = scheduleFilter ? `&schedule_id=${encodeURIComponent(scheduleFilter.id)}` : ''
  const { data, error, isLoading, mutate } = useSWRFetch<{ data?: Drill[]; total?: number }>(
    `${LIST_URL}?limit=${perPage}&offset=${page * perPage}${filterParam}`,
    { refreshInterval, keepPreviousData: true },
  )
  const drills = useMemo(() => data?.data ?? [], [data])
  const total = data?.total ?? drills.length

  useEffect(() => {
    setRefreshInterval(drillsPollIntervalMs(data?.data))
  }, [data])

  // The history shrank under the current page (rows purged): back to the last one.
  useEffect(() => {
    const last = Math.max(0, Math.ceil(total / perPage) - 1)
    if (page > last) setPage(last)
  }, [total, perPage, page])

  useEffect(() => {
    if (refreshKey) void mutate()
  }, [refreshKey, mutate])

  const [expanded, setExpanded] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const connName = useMemo(() => {
    const m = new Map(pveConnections.map(c => [c.id, c.name || c.id]))
    return (id: string) => m.get(id) || id
  }, [pveConnections])

  const filterBy = (schedule: Pick<Schedule, 'id' | 'name'> | null) => {
    setScheduleFilter(schedule ? { id: schedule.id, name: schedule.name } : null)
    setPage(0)
  }

  return (
    <Box>
      <RestoreDrillSchedules
        pveConnections={pveConnections}
        pbsConnections={pbsConnections}
        drills={data?.data ?? null}
        canRestore={canRestore}
        onShowDrills={filterBy}
        onDrillsChanged={() => void mutate()}
      />

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Typography variant='body2' color='text.secondary'>
            {t(`${P}.count`, { count: total })}
          </Typography>
          {scheduleFilter && (
            <Chip
              size='small'
              color='primary'
              variant='outlined'
              icon={<i className='ri-calendar-schedule-line' style={{ fontSize: 14 }} />}
              label={t(`${P}.schedules.filterChip`, { name: scheduleFilter.name })}
              onDelete={() => filterBy(null)}
              deleteIcon={<i className='ri-close-line' aria-label={t(`${P}.schedules.clearFilter`)} />}
              sx={{ height: 22, maxWidth: 320 }}
              data-testid='drills-schedule-filter'
            />
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title={t('common.refresh')}>
            <span>
              <IconButton size='small' onClick={() => void mutate()} disabled={isLoading} aria-label={t('common.refresh')}>
                {isLoading ? <CircularProgress size={16} /> : <i className='ri-refresh-line' style={{ fontSize: 18 }} />}
              </IconButton>
            </span>
          </Tooltip>
          {canEditSettings && (
            <Tooltip title={t(`${P}.settings.title`)}>
              <IconButton size='small' onClick={() => setSettingsOpen(true)} aria-label={t(`${P}.settings.title`)}>
                <i className='ri-settings-3-line' style={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {error && !data && <Alert severity='error'>{t(`${P}.loadError`)}</Alert>}

      {!error && !isLoading && drills.length === 0 && (
        <Typography variant='body2' color='text.secondary' sx={{ py: 3, textAlign: 'center' }}>
          {t(`${P}.empty`)}
        </Typography>
      )}

      {drills.length > 0 && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: ROW_COLUMNS, columnGap: 1.5, px: 1.5, pb: 0.5 }}>
            <span />
            {['colSource', 'colOrigin', 'colRestorePoint', 'colTarget', 'colDuration', 'colResult', 'colCleanup'].map(k => (
              <Typography key={k} variant='caption' color='text.secondary' sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {t(`${P}.${k}`)}
              </Typography>
            ))}
            <span />
            <span />
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {drills.map(drill => (
              <DrillRow
                key={drill.id}
                drill={drill}
                clusterName={connName(drill.connection_id)}
                expanded={expanded === drill.id}
                onToggle={() => setExpanded(e => (e === drill.id ? null : drill.id))}
                canRestore={canRestore}
                onChanged={() => void mutate()}
              />
            ))}
          </Box>
          {total > PAGE_SIZES[0] && (
            <TablePagination
              component='div'
              count={total}
              page={page}
              onPageChange={(_e, p) => setPage(p)}
              rowsPerPage={perPage}
              onRowsPerPageChange={e => { setPerPage(Number(e.target.value)); setPage(0) }}
              rowsPerPageOptions={PAGE_SIZES}
              labelRowsPerPage={t('common.rowsPerPage')}
              labelDisplayedRows={({ from, to, count }) => t(`${P}.displayedRows`, { from, to, count })}
              sx={STICKY_PAGER_SX}
              data-testid='restore-drills-pagination'
            />
          )}
        </>
      )}

      {settingsOpen && <RestoreDrillSettingsDialog onClose={() => setSettingsOpen(false)} />}
    </Box>
  )
}

interface DrillRowProps {
  drill: Drill
  clusterName: string
  expanded: boolean
  onToggle: () => void
  canRestore: boolean
  onChanged: () => void
}

function DrillRow({ drill, clusterName, expanded, onToggle, canRestore, onChanged }: DrillRowProps) {
  const t = useTranslations()
  const locale = useLocale()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const glyph = drillIcon(drill)
  const status = statusChip(drill)
  const result = resultChip(drill)
  const cleanup = cleanupGlyph(drill)
  const backupDate = drill.source?.backup_time ? formatDateTime(new Date(drill.source.backup_time), locale) : '-'
  const target = [clusterName, drill.node, drill.target_storage].filter(Boolean).join(' / ')
  const sourceName = drill.source?.vm_name || `VM ${drill.source?.backup_id ?? ''}`
  const origin = drillOrigin(drill)

  const post = async (action: 'cancel' | 'cleanup') => {
    setBusy(action)
    try {
      const res = await fetch(`${LIST_URL}/${encodeURIComponent(drill.id)}/${action}`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) toast.success(t(action === 'cancel' ? `${P}.actions.cancelRequested` : `${P}.actions.cleanupRestarted`))
      else toast.error(t(`${P}.actions.error`, { error: json?.error || `HTTP ${res.status}` }))
      onChanged()
    } catch (e: any) {
      toast.error(t(`${P}.actions.error`, { error: e?.message || 'error' }))
    } finally {
      setBusy(null)
    }
  }

  const exportEvidence = async () => {
    setBusy('evidence')
    try {
      const res = await fetch(`${LIST_URL}/${encodeURIComponent(drill.id)}/evidence`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(t(`${P}.actions.error`, { error: json?.error || `HTTP ${res.status}` }))
        return
      }
      const blob = await res.blob()
      const name = filenameFromDisposition(res.headers.get('content-disposition'), `restore-drill-${drill.id.slice(0, 8)}.pdf`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      toast.error(t(`${P}.actions.error`, { error: e?.message || 'error' }))
    } finally {
      setBusy(null)
    }
  }

  let resultLabel = ''
  if (result) resultLabel = result.stageKey ? t(result.key, { stage: t(result.stageKey) }) : t(result.key)

  return (
    <Box sx={{ borderRadius: 1, border: 1, borderColor: expanded ? 'divider' : 'transparent' }} data-testid={`drill-row-${drill.id}`}>
      <Box
        onClick={onToggle}
        sx={{
          display: 'grid', gridTemplateColumns: ROW_COLUMNS, columnGap: 1.5, alignItems: 'center',
          py: 0.75, px: 1.5, borderRadius: 1, whiteSpace: 'nowrap', cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Tooltip title={t(glyph.key)}>
          <Box component='i' className={glyph.icon} aria-label={t(glyph.key)} sx={{ color: glyph.color, fontSize: 18, display: 'flex', ...spinSx(glyph.icon) }} />
        </Tooltip>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <i className='ri-computer-line' style={{ fontSize: '0.9286rem', opacity: 0.8, flexShrink: 0 }} />
          <Typography variant='body2' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{sourceName}</Typography>
          <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>#{drill.source?.backup_id}</Typography>
        </Box>
        {origin ? (
          <Tooltip title={`${t(`${P}.origin`)}: ${origin}`}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }} data-testid='drill-origin'>
              <Box component='i' className='ri-calendar-schedule-line' sx={{ fontSize: '0.9286rem', color: 'primary.main', flexShrink: 0 }} />
              <Typography variant='body2' sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{origin}</Typography>
            </Box>
          </Tooltip>
        ) : (
          <Typography variant='body2' color='text.secondary' data-testid='drill-origin'>{t(`${P}.originManual`)}</Typography>
        )}
        <Typography variant='body2' sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{backupDate}</Typography>
        <Typography variant='body2' sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{target}</Typography>
        <Typography variant='body2'>{formatDuration(drillDurationSec(drill))}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, overflow: 'hidden' }}>
          {result
            ? <Chip size='small' color={result.color} label={resultLabel} sx={{ height: 22, minWidth: 0 }} />
            : <Chip size='small' color={status.color} variant='outlined' label={t(status.key)} sx={{ height: 22, minWidth: 0 }} />}
        </Box>
        {cleanup ? (
          <Tooltip title={t(cleanup.key)}>
            <Box component='i' className={cleanup.icon} aria-label={t(cleanup.key)} role='img'
              data-testid={drill.cleanup_state === 'failed' ? 'drill-cleanup-failed' : undefined}
              sx={{ color: cleanup.color, fontSize: 18, display: 'flex', ...spinSx(cleanup.icon) }} />
          </Tooltip>
        ) : (
          <Typography variant='body2' color='text.disabled'>-</Typography>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.25 }} onClick={e => e.stopPropagation()}>
          {canRestore && canCancel(drill) && (
            <Tooltip title={t(`${P}.actions.cancel`)}>
              <span>
                <IconButton size='small' disabled={!!busy} onClick={() => void post('cancel')} aria-label={t(`${P}.actions.cancel`)}>
                  {busy === 'cancel' ? <CircularProgress size={14} /> : <i className='ri-stop-circle-line' style={{ fontSize: 18 }} />}
                </IconButton>
              </span>
            </Tooltip>
          )}
          {canRestore && canRetryCleanup(drill) && (
            <Tooltip title={t(`${P}.actions.retryCleanup`)}>
              <span>
                <IconButton size='small' disabled={!!busy} onClick={() => void post('cleanup')} aria-label={t(`${P}.actions.retryCleanup`)}>
                  {busy === 'cleanup' ? <CircularProgress size={14} /> : <i className='ri-delete-bin-2-line' style={{ fontSize: 18 }} />}
                </IconButton>
              </span>
            </Tooltip>
          )}
          {canExportEvidence(drill) && (
            <Tooltip title={t(`${P}.actions.exportEvidence`)}>
              <span>
                <IconButton size='small' disabled={!!busy} onClick={() => void exportEvidence()} aria-label={t(`${P}.actions.exportEvidence`)}>
                  {busy === 'evidence' ? <CircularProgress size={14} /> : <i className='ri-file-download-line' style={{ fontSize: 18 }} />}
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
        <i className={expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 18, opacity: 0.6 }} />
      </Box>
      <Collapse in={expanded} unmountOnExit>
        <DrillDetail drill={drill} />
      </Collapse>
    </Box>
  )
}

function DrillDetail({ drill }: { drill: Drill }) {
  const t = useTranslations()
  const locale = useLocale()
  const active = isDrillActive(drill)
  const { data } = useSWRFetch<{ drill?: Drill; events?: DrillEvent[] }>(
    `${LIST_URL}/${encodeURIComponent(drill.id)}`,
    { refreshInterval: active ? 5000 : 0 },
  )
  const events = data?.events ?? []
  const stages = orderedStages((data?.drill ?? drill).stages)
  const at = (v: string) => (v ? formatDateTime(new Date(v), locale) : '-')
  const networkLabel = drill.network_mode === 'bridge'
    ? `${t(`${P}.networkBridge`)} (${drill.bridge})`
    : t(`${P}.networkLinkDown`)

  return (
    <Box sx={{ px: 2, pb: 2, pt: 1, whiteSpace: 'normal' }}>
      <Typography variant='subtitle2' sx={{ mb: 1 }}>{t(`${P}.detail.stages`)}</Typography>
      <Stack spacing={0.75} sx={{ mb: 2 }}>
        {stages.map(stage => {
          const look = stageLook(stage.status)
          return (
            <Box key={stage.key} sx={{ display: 'grid', gridTemplateColumns: '20px 180px 130px 80px minmax(0, 1fr)', columnGap: 1.5, alignItems: 'center' }}>
              <Box component='i' className={look.icon} sx={{ color: look.color, fontSize: 18, display: 'flex', ...spinSx(look.icon) }} />
              <Typography variant='body2' sx={{ fontWeight: 600 }}>{t(stageLabelKey(stage.key))}</Typography>
              <Typography variant='body2' sx={{ color: look.color }}>{t(look.key)}</Typography>
              <Typography variant='body2' color='text.secondary'>{formatDuration(stageDurationSec(stage))}</Typography>
              <Typography variant='body2' color='text.secondary' sx={{ overflowWrap: 'anywhere' }}>{stage.detail || ''}</Typography>
            </Box>
          )
        })}
      </Stack>

      {drill.result === 'vm_started' && <Alert severity='warning' sx={{ mb: 1 }}>{t(`${P}.pdf.vmStartedNote`)}</Alert>}
      {drill.error && <Alert severity={drill.status === 'cancelled' ? 'warning' : 'error'} sx={{ mb: 1 }}>{drill.error}</Alert>}
      {drill.cleanup_error && <Alert severity='error' sx={{ mb: 1 }}>{t(`${P}.detail.cleanupError`, { error: drill.cleanup_error })}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px minmax(0, 1fr)' }, columnGap: 2, rowGap: 0.5, mb: 2 }}>
        <DetailField label={t(`${P}.detail.tempGuest`)}>
          {drill.temp_vmid ? t(`${P}.detail.tempGuestValue`, { vmid: String(drill.temp_vmid), name: drill.temp_name || '-' }) : '-'}
        </DetailField>
        <DetailField label={t(`${P}.network`)}>{networkLabel}</DetailField>
        <DetailField label={t(`${P}.detail.archive`)}>{drill.source?.archive || '-'}</DetailField>
        <DetailField label={t(`${P}.pbsVerification`)}>{t(`${P}.verify.${drill.source?.verify_state || 'none'}`)}</DetailField>
        <DetailField label={t(`${P}.detail.requestedBy`)}>{drill.requested_by || '-'}</DetailField>
        <DetailField label={t(`${P}.origin`)}>{drillOrigin(drill) ?? t(`${P}.originManual`)}</DetailField>
        <DetailField label={t(`${P}.detail.created`)}>{at(drill.created_at)}</DetailField>
        {drill.queued_at && <DetailField label={t(`${P}.detail.queued`)}>{at(drill.queued_at)}</DetailField>}
        <DetailField label={t(`${P}.detail.finished`)}>{at(drill.finished_at)}</DetailField>
        {drill.cleaned_at && <DetailField label={t(`${P}.detail.cleaned`)}>{at(drill.cleaned_at)}</DetailField>}
        <DrillScreenshot drill={data?.drill ?? drill} />
      </Box>

      <Typography variant='subtitle2' sx={{ mb: 1 }}>{t(`${P}.detail.events`)}</Typography>
      {events.length === 0 ? (
        <Typography variant='body2' color='text.secondary'>{t(`${P}.detail.noEvents`)}</Typography>
      ) : (
        <EventLog events={events} testId='drill-events' />
      )}
    </Box>
  )
}

/** Console capture of the test VM, information only: nothing before a capture was attempted. */
function DrillScreenshot({ drill }: { drill: Drill }) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)

  if (drill.screenshot_state === 'unavailable') {
    return (
      <DetailField label={t(`${P}.screenshot.title`)}>
        <Box component='span' sx={{ color: 'text.secondary' }} data-testid='drill-screenshot-unavailable'>
          {drill.screenshot_error
            ? t(`${P}.screenshot.unavailableReason`, { reason: drill.screenshot_error })
            : t(`${P}.screenshot.unavailable`)}
        </Box>
      </DetailField>
    )
  }
  if (drill.screenshot_state !== 'captured') return null

  const src = `${LIST_URL}/${encodeURIComponent(drill.id)}/screenshot`
  const capturedAt = t(`${P}.screenshot.capturedAt`, { time: utc(drill.screenshot_at) })
  const label = drill.temp_vmid
    ? t(`${P}.detail.tempGuestValue`, { vmid: String(drill.temp_vmid), name: drill.temp_name || '-' })
    : t(`${P}.screenshot.title`)

  return (
    <DetailField label={t(`${P}.screenshot.title`)}>
      <Tooltip title={capturedAt} arrow>
        <Box
          component='img'
          src={src}
          alt={t(`${P}.screenshot.title`)}
          onClick={() => setOpen(true)}
          sx={{
            height: 72,
            borderRadius: 0.5,
            border: '1px solid',
            borderColor: 'divider',
            cursor: 'pointer',
            display: 'block',
            '&:hover': { borderColor: 'primary.main' },
          }}
        />
      </Tooltip>
      <ImagePreviewDialog open={open} src={src} label={label} capturedAt={capturedAt} onClose={() => setOpen(false)} />
    </DetailField>
  )
}
