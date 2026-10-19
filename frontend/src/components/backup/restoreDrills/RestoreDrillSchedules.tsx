'use client'

// Schedules section of the Restore drills tab (roadmap#35, addendum 4): one
// line per schedule, server paginated, with its scope, recurrence, next run
// and last pass; the details, last passes and events under the chevron.

import { useEffect, useMemo, useState } from 'react'

import { useLocale, useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  Stack,
  Switch,
  TablePagination,
  Tooltip,
  Typography,
} from '@mui/material'

import { parseSchedule } from '@/app/(dashboard)/operations/backups/BackupSchedulePicker'
import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { PAGE_SIZES, STICKY_PAGER_SX } from '@/components/ui/PagedRows'
import { useToast } from '@/contexts/ToastContext'
import { useSWRFetch } from '@/hooks/useSWRFetch'
import {
  runResultChip,
  scheduleIcon,
  scheduleScopeSummary,
  schedulesPollIntervalMs,
} from '@/lib/backups/restoreDrills/display'
import { scheduleToggleBody } from '@/lib/backups/restoreDrills/schedules'
import type { Drill, DrillEvent, Schedule, ScheduleRun } from '@/lib/backups/restoreDrills/types'
import { formatDateTime } from '@/lib/i18n/date'

import RestoreDrillScheduleDialog, { type PbsConnection } from './RestoreDrillScheduleDialog'
import { DetailField, EventLog, spinSx } from './shared'

const P = 'backups.restoreDrills'
const S = `${P}.schedules`
const SCHEDULES_URL = '/api/v1/backups/restore-drills/schedules'

// Glyph, name, scope, recurrence, next run, last pass, switch, actions, chevron.
const ROW_COLUMNS = '20px minmax(140px, 1.2fr) minmax(120px, 1fr) minmax(150px, 1fr) 150px 120px 44px 100px 28px'

type Translate = ReturnType<typeof useTranslations>

// PVE calendar keywords, as the orchestrator reads them.
const KEYWORD_SCHEDULES: Record<string, string> = { daily: '00:00', weekly: 'mon 00:00', monthly: '*-*-01 00:00' }
const EVERY_MINUTES_RE = /^\*\/(\d{1,2})$/

/**
 * The recurrence in words, in the reader's language: "Every minute",
 * "Daily at 02:00", "Every Monday at 03:30". An expression with no simple
 * form keeps its raw text.
 */
export function recurrenceText(calendar: string, t: Translate): string {
  const raw = (calendar || '').trim()
  if (!raw) return '-'
  const keyword = raw.toLowerCase()
  if (keyword === 'minutely' || keyword === '*/1') return t(`${S}.recurrence.minutely`)
  if (keyword === 'hourly') return t(`${S}.recurrence.hourly`)
  const every = EVERY_MINUTES_RE.exec(keyword)
  if (every) return t(`${S}.recurrence.everyMinutes`, { n: Number(every[1]) })
  const parsed = parseSchedule(KEYWORD_SCHEDULES[keyword] ?? raw)
  if (parsed.advanced) return raw
  if (parsed.frequency === 'weekly') {
    const days = parsed.days.map((d: string) => t(`${S}.weekdayLong.${d}`)).join(', ')
    return t(`${S}.recurrence.weekly`, { days, time: parsed.time })
  }
  if (parsed.frequency === 'monthly') return t(`${S}.recurrence.monthly`, { day: parsed.dayOfMonth, time: parsed.time })
  return t(`${S}.recurrence.daily`, { time: parsed.time })
}

async function sendJson(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

interface Connection { id: string; name?: string }

interface RestoreDrillSchedulesProps {
  pveConnections?: Connection[]
  pbsConnections?: PbsConnection[]
  /** The drills on screen: an active one makes the list poll fast. */
  drills?: Drill[] | null
  canRestore: boolean
  /** Filters the history below by this schedule. */
  onShowDrills: (schedule: Pick<Schedule, 'id' | 'name'>) => void
  /** A pass was started: the history has new drills. */
  onDrillsChanged?: () => void
}

export default function RestoreDrillSchedules({
  pveConnections = [], pbsConnections = [], drills = null, canRestore, onShowDrills, onDrillsChanged,
}: RestoreDrillSchedulesProps) {
  const t = useTranslations()
  const [open, setOpen] = useState(true)
  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(PAGE_SIZES[0])
  const [refreshInterval, setRefreshInterval] = useState(() => schedulesPollIntervalMs(null, drills))
  const { data, error, isLoading, mutate } = useSWRFetch<{ data?: Schedule[]; total?: number }>(
    `${SCHEDULES_URL}?limit=${perPage}&offset=${page * perPage}`,
    { refreshInterval, keepPreviousData: true },
  )
  const schedules = useMemo(() => data?.data ?? [], [data])
  const total = data?.total ?? schedules.length

  useEffect(() => {
    setRefreshInterval(schedulesPollIntervalMs(data?.data, drills))
  }, [data, drills])

  useEffect(() => {
    const last = Math.max(0, Math.ceil(total / perPage) - 1)
    if (page > last) setPage(last)
  }, [total, perPage, page])

  const [expanded, setExpanded] = useState<string | null>(null)
  // undefined: closed; null: a new schedule.
  const [editing, setEditing] = useState<Schedule | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<Schedule | null>(null)

  const connName = useMemo(() => {
    const m = new Map(pveConnections.map(c => [c.id, c.name || c.id]))
    return (id: string) => m.get(id) || id
  }, [pveConnections])

  return (
    <Box sx={{ mb: 3 }} data-testid='restore-drill-schedules'>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, gap: 1 }}>
        <Box
          component='button'
          type='button'
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75, border: 0, p: 0, bgcolor: 'transparent', color: 'text.primary', cursor: 'pointer', font: 'inherit' }}
        >
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 18, opacity: 0.6 }} />
          <i className='ri-calendar-schedule-line' style={{ fontSize: 18 }} />
          <Typography variant='subtitle2' component='span'>{t(`${S}.title`)}</Typography>
          <Typography variant='body2' component='span' color='text.secondary'>{t(`${S}.count`, { count: total })}</Typography>
        </Box>
        {canRestore && (
          <Button size='small' variant='outlined' startIcon={<i className='ri-add-line' />} onClick={() => setEditing(null)}>
            {t(`${S}.new`)}
          </Button>
        )}
      </Box>

      <Collapse in={open}>
        {error && !data && <Alert severity='error'>{t(`${S}.loadError`)}</Alert>}

        {!error && !isLoading && schedules.length === 0 && (
          <Typography variant='body2' color='text.secondary' sx={{ py: 2, textAlign: 'center' }}>
            {t(`${S}.empty`)}
          </Typography>
        )}

        {schedules.length > 0 && (
          <>
            <Box sx={{ display: 'grid', gridTemplateColumns: ROW_COLUMNS, columnGap: 1.5, px: 1.5, pb: 0.5 }}>
              <span />
              {['colName', 'colScope', 'colRecurrence', 'colNextRun', 'colLastRun'].map(k => (
                <Typography key={k} variant='caption' color='text.secondary' sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {t(`${S}.${k}`)}
                </Typography>
              ))}
              <span />
              <span />
              <span />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {schedules.map(schedule => (
                <ScheduleRow
                  key={schedule.id}
                  schedule={schedule}
                  clusterName={connName(schedule.connection_id)}
                  expanded={expanded === schedule.id}
                  onToggle={() => setExpanded(e => (e === schedule.id ? null : schedule.id))}
                  canRestore={canRestore}
                  onChanged={() => void mutate()}
                  onRan={() => { void mutate(); onDrillsChanged?.() }}
                  onEdit={() => setEditing(schedule)}
                  onDelete={() => setDeleting(schedule)}
                  onShowDrills={() => onShowDrills(schedule)}
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
                data-testid='restore-drill-schedules-pagination'
              />
            )}
          </>
        )}
      </Collapse>

      {editing !== undefined && (
        <RestoreDrillScheduleDialog
          schedule={editing}
          pbsConnections={pbsConnections}
          onClose={() => setEditing(undefined)}
          onSaved={() => void mutate()}
        />
      )}
      {deleting && (
        <DeleteScheduleDialog
          schedule={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            if (expanded === deleting.id) setExpanded(null)
            void mutate()
          }}
        />
      )}
    </Box>
  )
}

interface ScheduleRowProps {
  schedule: Schedule
  clusterName: string
  expanded: boolean
  onToggle: () => void
  canRestore: boolean
  onChanged: () => void
  onRan: () => void
  onEdit: () => void
  onDelete: () => void
  onShowDrills: () => void
}

function ScheduleRow({ schedule, clusterName, expanded, onToggle, canRestore, onChanged, onRan, onEdit, onDelete, onShowDrills }: ScheduleRowProps) {
  const t = useTranslations()
  const locale = useLocale()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const glyph = scheduleIcon(schedule)
  const scope = scheduleScopeSummary(schedule)
  const last = runResultChip(schedule.last_run)
  let nextRun = '-'
  if (!schedule.enabled) nextRun = t(`${S}.disabled`)
  else if (schedule.next_run_at) nextRun = formatDateTime(new Date(schedule.next_run_at), locale)

  const act = async (kind: 'toggle' | 'run', run: () => Promise<{ ok: boolean; status: number; json: any }>, success: string | null) => {
    setBusy(kind)
    try {
      const res = await run()
      if (res.ok) {
        if (success) toast.success(t(success))
      } else {
        toast.error(t(`${P}.actions.error`, { error: res.json?.error || `HTTP ${res.status}` }))
      }
      if (kind === 'run') onRan()
      else onChanged()
    } catch (e: any) {
      toast.error(t(`${P}.actions.error`, { error: e?.message || 'error' }))
    } finally {
      setBusy(null)
    }
  }

  const url = `${SCHEDULES_URL}/${encodeURIComponent(schedule.id)}`
  const toggle = (enabled: boolean) => act('toggle', () => sendJson(url, 'PUT', scheduleToggleBody(schedule, enabled)), null)
  const runNow = () => act('run', () => sendJson(`${url}/run`, 'POST'), `${S}.actions.runStarted`)

  return (
    <Box sx={{ borderRadius: 1, border: 1, borderColor: expanded ? 'divider' : 'transparent' }} data-testid={`schedule-row-${schedule.id}`}>
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
        <Typography variant='body2' sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{schedule.name}</Typography>
        <Typography variant='body2' sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(scope.key, scope.values)}</Typography>
        <Typography variant='body2' sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{recurrenceText(schedule.calendar, t)}</Typography>
        <Typography variant='body2' color={schedule.enabled ? 'text.primary' : 'text.secondary'} sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {nextRun}
        </Typography>
        <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
          {last
            ? <Chip size='small' color={last.color} label={t(last.key)} sx={{ height: 22, minWidth: 0 }} />
            : <Typography variant='body2' color='text.secondary'>{t(`${S}.never`)}</Typography>}
        </Box>
        <Box onClick={e => e.stopPropagation()}>
          <Tooltip title={t(`${S}.actions.toggle`)}>
            <span>
              <Switch
                size='small'
                checked={schedule.enabled}
                disabled={!canRestore || !!busy}
                onChange={(_e, v) => void toggle(v)}
                slotProps={{ input: { 'aria-label': t(`${S}.actions.toggle`) } as any }}
              />
            </span>
          </Tooltip>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.25 }} onClick={e => e.stopPropagation()}>
          {canRestore && (
            <>
              <Tooltip title={t(`${S}.actions.runNow`)}>
                <span>
                  <IconButton size='small' disabled={!!busy} onClick={() => void runNow()} aria-label={t(`${S}.actions.runNow`)}>
                    {busy === 'run' ? <CircularProgress size={14} /> : <i className='ri-play-line' style={{ fontSize: 18 }} />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t(`${S}.actions.edit`)}>
                <IconButton size='small' onClick={onEdit} aria-label={t(`${S}.actions.edit`)}>
                  <i className='ri-pencil-line' style={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t(`${S}.actions.delete`)}>
                <IconButton size='small' onClick={onDelete} aria-label={t(`${S}.actions.delete`)}>
                  <i className='ri-delete-bin-line' style={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Box>
        <i className={expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 18, opacity: 0.6 }} />
      </Box>
      <Collapse in={expanded} unmountOnExit>
        <ScheduleDetail schedule={schedule} clusterName={clusterName} onShowDrills={onShowDrills} />
      </Collapse>
    </Box>
  )
}

function ScheduleDetail({ schedule, clusterName, onShowDrills }: { schedule: Schedule; clusterName: string; onShowDrills: () => void }) {
  const t = useTranslations()
  const locale = useLocale()
  const running = schedule.last_run?.state === 'running'
  const { data } = useSWRFetch<{ schedule?: Schedule; runs?: ScheduleRun[]; events?: DrillEvent[] }>(
    `${SCHEDULES_URL}/${encodeURIComponent(schedule.id)}`,
    { refreshInterval: running ? 5000 : 0 },
  )
  const runs = data?.runs ?? []
  const events = data?.events ?? []
  const src = schedule.source
  const networkLabel = schedule.network_mode === 'bridge'
    ? `${t(`${P}.networkBridge`)} (${schedule.bridge})`
    : t(`${P}.networkLinkDown`)
  const at = (v: string | null | undefined) => (v ? formatDateTime(new Date(v), locale) : '-')

  return (
    <Box sx={{ px: 2, pb: 2, pt: 1, whiteSpace: 'normal' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px minmax(0, 1fr)' }, columnGap: 2, rowGap: 0.5, mb: 2 }}>
        <DetailField label={t(`${S}.detail.source`)}>
          {[src?.pbs_name || src?.pbs_id, src?.datastore, src?.namespace || t(`${S}.form.rootNamespace`)].filter(Boolean).join(' / ')}
        </DetailField>
        {schedule.scope?.mode === 'vms' && (
          <DetailField label={t(`${S}.detail.vms`)}>{(schedule.scope.vmids ?? []).join(', ')}</DetailField>
        )}
        <DetailField label={t(`${S}.detail.recurrence`)}>{recurrenceText(schedule.calendar, t)}</DetailField>
        <DetailField label={t(`${S}.detail.restorePoint`)}>{t(`${S}.restorePoint.${schedule.restore_point === 'latest_verified' ? 'latest_verified' : 'latest'}`)}</DetailField>
        <DetailField label={t(`${P}.target`)}>{[clusterName, schedule.node, schedule.target_storage].filter(Boolean).join(' / ')}</DetailField>
        <DetailField label={t(`${P}.network`)}>{networkLabel}</DetailField>
        <DetailField label={t(`${S}.detail.perRun`)}>{schedule.vms_per_run}</DetailField>
        <DetailField label={t(`${S}.detail.rotation`)}>
          {schedule.rotation_last_vmid ? t(`${S}.detail.rotationValue`, { vmid: String(schedule.rotation_last_vmid) }) : t(`${S}.detail.rotationStart`)}
        </DetailField>
        <DetailField label={t(`${S}.detail.createdBy`)}>{schedule.created_by || '-'}</DetailField>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant='subtitle2'>{t(`${S}.detail.lastRuns`)}</Typography>
        <Button size='small' startIcon={<i className='ri-filter-3-line' />} onClick={onShowDrills}>
          {t(`${S}.actions.showDrills`)}
        </Button>
      </Box>
      {runs.length === 0 ? (
        <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>{t(`${S}.detail.noRuns`)}</Typography>
      ) : (
        <Stack spacing={0.75} sx={{ mb: 2 }} data-testid='schedule-runs'>
          {runs.map(run => {
            const chip = runResultChip(run)
            return (
              <Box key={run.id}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '150px 110px 80px minmax(0, 1fr)', columnGap: 1.5, alignItems: 'center' }}>
                  <Typography variant='body2'>{at(run.started_at)}</Typography>
                  {chip ? <Chip size='small' color={chip.color} label={t(chip.key)} sx={{ height: 22, justifySelf: 'start' }} /> : <span />}
                  <Typography variant='body2' color='text.secondary'>{t(`${S}.detail.runDrills`, { count: run.drill_ids?.length ?? 0 })}</Typography>
                  <Typography variant='body2' color='text.secondary' sx={{ overflowWrap: 'anywhere' }}>{run.summary || ''}</Typography>
                </Box>
                {(run.skipped_vmids?.length ?? 0) > 0 && (
                  <Typography variant='caption' color='warning.main' sx={{ display: 'block', ml: '162px' }}>
                    {`${t(`${S}.detail.skipped`)}: ${run.skipped_vmids.map(v => t(`${S}.detail.skippedVm`, { vmid: String(v.vmid), reason: v.reason })).join(' · ')}`}
                  </Typography>
                )}
              </Box>
            )
          })}
        </Stack>
      )}

      <Typography variant='subtitle2' sx={{ mb: 1 }}>{t(`${S}.detail.events`)}</Typography>
      {events.length === 0
        ? <Typography variant='body2' color='text.secondary'>{t(`${P}.detail.noEvents`)}</Typography>
        : <EventLog events={events} testId='schedule-events' />}
    </Box>
  )
}

function DeleteScheduleDialog({ schedule, onClose, onDeleted }: { schedule: Schedule; onClose: () => void; onDeleted: () => void }) {
  const t = useTranslations()
  const toast = useToast()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setWorking(true)
    setError(null)
    try {
      const res = await sendJson(`${SCHEDULES_URL}/${encodeURIComponent(schedule.id)}`, 'DELETE')
      if (!res.ok) {
        setError(t(`${P}.actions.error`, { error: res.json?.error || `HTTP ${res.status}` }))
        return
      }
      toast.success(t(`${S}.actions.deleted`))
      onDeleted()
      onClose()
    } catch (e: any) {
      setError(t(`${P}.actions.error`, { error: e?.message || 'error' }))
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open onClose={working ? undefined : onClose} maxWidth='xs' fullWidth aria-labelledby='delete-schedule-title'>
      <AppDialogTitle onClose={working ? undefined : onClose} icon={<Box component='i' className='ri-delete-bin-line' sx={{ fontSize: 20, color: 'error.main' }} />}>
        <span id='delete-schedule-title'>{t(`${S}.deleteTitle`)}</span>
      </AppDialogTitle>
      <DialogContent>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant='body2'>{t(`${S}.deleteConfirm`, { name: schedule.name })}</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={working}>{t('common.cancel')}</Button>
        <Button variant='contained' color='error' onClick={() => void confirm()} disabled={working}
          startIcon={working ? <CircularProgress size={14} color='inherit' /> : <i className='ri-delete-bin-line' />}>
          {t(`${S}.actions.delete`)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
