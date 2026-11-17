'use client'

// Settings > Platform status: the state of the ProxCenter installation
// itself. Services, host load, disks, database and the orchestrator's
// scheduled tasks, read by GET /api/v1/system/status and refreshed while the
// tab is open. Enterprise (Features.PLATFORM_STATUS), provider administrators
// only: gated in settings/page.jsx and on the routes.

import { useState, type ReactNode } from 'react'

import { Alert, Box, Card, CardContent, Chip, CircularProgress, IconButton, LinearProgress, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import { useLocale, useTranslations } from 'next-intl'

import PagedRows from '@/components/ui/PagedRows'
import { useSWRFetch } from '@/hooks/useSWRFetch'
import {
  formatDurationMs,
  formatSchedule,
  percent,
  relativeTime,
  sortTasks,
  STATE_COLOR,
  TASK_COLOR,
  taskState,
  type TaskState,
  usageSeverity
} from '@/lib/platform/display'
import type {
  DatabaseInfo,
  DiskInfo,
  FrontendInfo,
  HostHistoryRange,
  HostInfo,
  OrchestratorStatus,
  OrchestratorTask,
  PlatformStatus,
  ServiceSummary
} from '@/lib/platform/types'
import { formatBytes, formatUptime } from '@/utils/format'

import HaNodesSection from './HaNodesSection'
import HostHistoryCharts, { HistoryRangeToggle } from './HostHistoryCharts'

const STATUS_URL = '/api/v1/system/status'
const REFRESH_MS = 10_000
const DASH = '-'

const STATE_ICON: Record<ServiceSummary['state'], string> = {
  up: 'ri-checkbox-circle-line',
  degraded: 'ri-error-warning-line',
  down: 'ri-close-circle-line',
  unknown: 'ri-question-line'
}

const TASK_ICON: Record<TaskState, string> = {
  ok: 'ri-checkbox-circle-line',
  failing: 'ri-close-circle-line',
  running: 'ri-play-circle-line',
  idle: 'ri-time-line'
}

const SERVICE_ICON: Record<ServiceSummary['id'], string> = {
  frontend: 'ri-window-line',
  database: 'ri-database-2-line',
  orchestrator: 'ri-settings-3-line',
  renderer: 'ri-file-pdf-2-line'
}

/** Leading glyph of a row: an icon with the status dot at its bottom right. */
function Glyph({ icon, color, label }: Readonly<{ icon: string; color: string; label: string }>) {
  return (
    <Box role='img' aria-label={label} sx={{ position: 'relative', width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <i className={icon} style={{ fontSize: 16, opacity: 0.8 }} />
      <Box sx={{ position: 'absolute', right: -1, bottom: -1, width: 7, height: 7, borderRadius: '50%', bgcolor: color, border: '1px solid', borderColor: 'background.paper' }} />
    </Box>
  )
}

function Section({ icon, title, action, children }: Readonly<{ icon: string; title: string; action?: ReactNode; children: ReactNode }>) {
  return (
    <Card variant='outlined'>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <i className={icon} style={{ fontSize: 18 }} />
          <Typography variant='subtitle1' fontWeight={700} sx={{ flex: 1 }}>
            {title}
          </Typography>
          {action}
        </Box>
        {children}
      </CardContent>
    </Card>
  )
}

/** One-line table: fixed columns, the first one takes what is left. */
function Row({ columns, header, children }: Readonly<{ columns: string; header?: boolean; children: ReactNode }>) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: columns,
        alignItems: 'center',
        columnGap: 3,
        minHeight: 34,
        px: 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
        '& > *': { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        ...(header ? { color: 'text.secondary', minHeight: 28 } : { '&:hover': { bgcolor: 'action.hover' } })
      }}
    >
      {children}
    </Box>
  )
}

/** On a narrow screen a table scrolls sideways instead of cutting its last columns. */
function TableScroll({ minWidth, children }: Readonly<{ minWidth: number; children: ReactNode }>) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box sx={{ minWidth }}>{children}</Box>
    </Box>
  )
}

const Head = ({ children, right }: Readonly<{ children?: ReactNode; right?: boolean }>) => (
  <Typography variant='caption' fontWeight={600} sx={{ textAlign: right ? 'right' : 'left' }}>
    {children}
  </Typography>
)

const Cell = ({ children, right, muted }: Readonly<{ children?: ReactNode; right?: boolean; muted?: boolean }>) => (
  <Typography variant='body2' color={muted ? 'text.secondary' : 'text.primary'} sx={{ textAlign: right ? 'right' : 'left' }}>
    {children}
  </Typography>
)

/**
 * A labelled figure: icon, label and value side by side. The figures of a
 * section share one line, each centred in an equal share of its width.
 */
function Stat({ icon, label, value }: Readonly<{ icon: string; label: string; value: ReactNode }>) {
  return (
    <Box sx={{ flex: '1 1 0', minWidth: 'max-content', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
      <i className={icon} aria-hidden='true' style={{ fontSize: 16, opacity: 0.7 }} />
      <Typography variant='body2' color='text.secondary'>
        {label}
      </Typography>
      <Typography variant='body2' fontWeight={600}>
        {value}
      </Typography>
    </Box>
  )
}

// Pixel gaps: the app theme and the default one do not share a spacing unit.
// One line, always: on a narrow screen the line scrolls rather than wraps.
const STATS_SX = { display: 'flex', flexWrap: 'nowrap', alignItems: 'center', columnGap: '14px', mb: 2, overflowX: 'auto' } as const

/** Label, bar and figure on one line. */
function Meter({ label, pct, severity, value }: Readonly<{ label: string; pct: number; severity: 'success' | 'warning' | 'error'; value: string }>) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '150px 1fr 170px', alignItems: 'center', columnGap: 2, minHeight: 34 }}>
      <Typography variant='body2' noWrap>
        {label}
      </Typography>
      <LinearProgress variant='determinate' value={pct} color={severity} aria-label={label} sx={{ height: 6, borderRadius: 3 }} />
      <Typography variant='body2' color='text.secondary' noWrap sx={{ textAlign: 'right' }}>
        {value}
      </Typography>
    </Box>
  )
}

const cpuText = (pct: number | null) => (pct === null ? DASH : `${pct.toFixed(1)} %`)

function memoryText(used: number | null, limit: number | null) {
  if (used === null) return DASH

  return limit ? `${formatBytes(used, 1)} / ${formatBytes(limit, 1)}` : formatBytes(used, 1)
}

function ServicesSection({ services, node }: Readonly<{ services: ServiceSummary[]; node: string | null }>) {
  const t = useTranslations('platformStatus')
  const columns = 'minmax(180px, 1fr) 110px 110px 90px 190px minmax(140px, 1fr)'

  return (
    <Section icon='ri-stack-line' title={node ? t('services.titleOn', { node }) : t('services.title')}>
      <TableScroll minWidth={880}>
      <Row columns={columns} header>
        <Head>{t('services.service')}</Head>
        <Head>{t('services.version')}</Head>
        <Head>{t('services.uptime')}</Head>
        <Head right>{t('services.cpu')}</Head>
        <Head right>{t('services.memory')}</Head>
        <Head>{t('services.state')}</Head>
      </Row>
      {services.map(s => (
        <Row key={s.id} columns={columns}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Glyph icon={SERVICE_ICON[s.id]} color={STATE_COLOR[s.state]} label={t(`state.${s.state}`)} />
            <Typography variant='body2' fontWeight={600} noWrap>
              {t(`services.names.${s.id}`)}
            </Typography>
          </Box>
          <Cell muted>{s.version ?? DASH}</Cell>
          <Cell muted>{s.uptimeSeconds === null ? DASH : formatUptime(s.uptimeSeconds)}</Cell>
          <Cell right muted>
            {cpuText(s.cpuPercent)}
          </Cell>
          <Cell right muted>
            {memoryText(s.memoryBytes, s.memoryLimitBytes)}
          </Cell>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <i className={STATE_ICON[s.state]} aria-hidden='true' style={{ fontSize: 16, color: STATE_COLOR[s.state], flexShrink: 0 }} />
            <Typography variant='body2' noWrap>
              {s.reason ? t(`reason.${s.reason}`) : t(`state.${s.state}`)}
            </Typography>
          </Box>
        </Row>
      ))}
      </TableScroll>
    </Section>
  )
}

function FrontendSection({ frontend }: Readonly<{ frontend: FrontendInfo }>) {
  const t = useTranslations('platformStatus')

  return (
    <Section icon='ri-window-line' title={t('frontend.title')}>
      <Box sx={{ ...STATS_SX, mb: 0 }}>
        <Stat icon='ri-price-tag-3-line' label={t('frontend.instance')} value={frontend.hostname || DASH} />
        <Stat icon='ri-ram-line' label={t('frontend.memory')} value={formatBytes(frontend.rssBytes, 1)} />
        <Stat icon='ri-stack-line' label={t('frontend.heap')} value={formatBytes(frontend.heapUsedBytes, 1)} />
        <Stat icon='ri-loop-right-line' label={t('frontend.eventLoop')} value={frontend.eventLoopDelayMs === null ? DASH : formatDurationMs(frontend.eventLoopDelayMs)} />
        <Stat icon='ri-nodejs-line' label={t('frontend.nodeVersion')} value={frontend.nodeVersion} />
      </Box>
    </Section>
  )
}

function HostSection({ host, disks, node }: Readonly<{ host: HostInfo | null; disks: DiskInfo[]; node: string | null }>) {
  const t = useTranslations('platformStatus')
  const [range, setRange] = useState<HostHistoryRange>('1h')

  if (!host && disks.length === 0) {
    return (
      <Section icon='ri-cpu-line' title={node ? t('host.titleOn', { node }) : t('host.title')}>
        <Typography variant='body2' color='text.secondary'>
          {t('host.unavailable')}
        </Typography>
      </Section>
    )
  }

  const memUsed = host ? host.memTotalBytes - host.memAvailableBytes : 0

  return (
    <Section
      icon='ri-cpu-line'
      title={node ? t('host.titleOn', { node }) : t('host.title')}
      action={host ? <HistoryRangeToggle value={range} onChange={setRange} /> : undefined}
    >
      {host && (
        <>
          <HostHistoryCharts range={range} />
          <Box sx={STATS_SX}>
            <Stat icon='ri-cpu-line' label={t('host.cpus')} value={host.cpus} />
            <Stat icon='ri-time-line' label={t('host.uptime')} value={formatUptime(host.uptimeSeconds)} />
            <Stat icon='ri-speed-up-line' label={t('host.loadNow')} value={[host.load1, host.load5, host.load15].map(v => v.toFixed(2)).join(' / ')} />
            {host.memTotalBytes > 0 && <Stat icon='ri-ram-line' label={t('host.memory')} value={`${formatBytes(memUsed, 1)} / ${formatBytes(host.memTotalBytes, 1)}`} />}
          </Box>
        </>
      )}
      {disks.map(disk => {
        const used = disk.totalBytes - disk.freeBytes
        const pct = percent(used, disk.totalBytes)

        return (
          <Meter
            key={disk.label}
            label={t(`host.disk.${disk.label}`)}
            pct={pct}
            severity={usageSeverity(pct)}
            value={`${formatBytes(used, 1)} / ${formatBytes(disk.totalBytes, 1)}`}
          />
        )
      })}
    </Section>
  )
}

function DatabaseSection({ database, nowMs }: Readonly<{ database: DatabaseInfo | null; nowMs: number }>) {
  const t = useTranslations('platformStatus')
  const locale = useLocale()
  const columns = 'minmax(200px, 1fr) 120px 120px 120px 160px'

  if (!database) {
    return (
      <Section icon='ri-database-2-line' title={t('database.title')}>
        <Alert severity='error'>{t('database.unreachable')}</Alert>
      </Section>
    )
  }

  const number = new Intl.NumberFormat(locale)

  return (
    <Section icon='ri-database-2-line' title={t('database.title')}>
      <Box sx={STATS_SX}>
        <Stat icon='ri-database-2-line' label={t('database.size')} value={formatBytes(database.sizeBytes, 1)} />
        <Stat icon='ri-plug-line' label={t('database.connections')} value={`${database.connections} / ${database.maxConnections}`} />
        <Stat icon='ri-flashlight-line' label={t('database.active')} value={database.activeConnections} />
        <Stat icon='ri-speed-up-line' label={t('database.cacheHit')} value={database.cacheHitPercent === null ? DASH : `${database.cacheHitPercent.toFixed(1)} %`} />
        <Stat icon='ri-lock-line' label={t('database.deadlocks')} value={number.format(database.deadlocks)} />
        <Stat icon='ri-git-branch-line' label={t('database.role')} value={database.inRecovery ? t('database.replica') : t('database.primary')} />
        <Stat icon='ri-table-line' label={t('database.tables')} value={database.tables.length} />
      </Box>
      <TableScroll minWidth={780}>
      <Row columns={columns} header>
        <Head>{t('database.table')}</Head>
        <Head right>{t('database.rows')}</Head>
        <Head right>{t('database.tableSize')}</Head>
        <Head right>{t('database.deadRows')}</Head>
        <Head>{t('database.lastVacuum')}</Head>
      </Row>
      <PagedRows items={database.tables} testId='platform-tables-pager'>
        {table => (
          <Row key={table.name} columns={columns}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <i className='ri-table-line' style={{ fontSize: 16, opacity: 0.7, flexShrink: 0 }} />
              <Typography variant='body2' noWrap>
                {table.name}
              </Typography>
            </Box>
            <Cell right muted>
              {table.rows === null ? DASH : number.format(table.rows)}
            </Cell>
            <Cell right>{formatBytes(table.totalBytes, 1)}</Cell>
            <Cell right muted>
              {number.format(table.deadRows)}
            </Cell>
            <Cell muted>{relativeTime(table.lastVacuum, nowMs, locale) ?? t('never')}</Cell>
          </Row>
        )}
      </PagedRows>
      </TableScroll>
    </Section>
  )
}

function TaskRow({ task, nowMs, columns }: Readonly<{ task: OrchestratorTask; nowMs: number; columns: string }>) {
  const t = useTranslations('platformStatus')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const state = taskState(task)
  const hasError = Boolean(task.last_error)

  return (
    <>
      <Row columns={columns}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Glyph icon='ri-timer-line' color={TASK_COLOR[state]} label={t(`tasks.state.${state}`)} />
          <Typography variant='body2' noWrap>
            {task.name}
          </Typography>
        </Box>
        <Cell muted>{formatSchedule(task.schedule)}</Cell>
        <Cell muted>{relativeTime(task.last_run, nowMs, locale) ?? t('never')}</Cell>
        <Cell right muted>
          {task.runs > 0 ? formatDurationMs(task.last_duration_ms) : DASH}
        </Cell>
        <Cell right muted>
          {task.failures} / {task.runs}
        </Cell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i className={TASK_ICON[state]} aria-hidden='true' style={{ fontSize: 16, color: TASK_COLOR[state], flexShrink: 0 }} />
          <Typography variant='body2' noWrap>
            {t(`tasks.state.${state}`)}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          {hasError && (
            <IconButton size='small' aria-label={t('tasks.showError')} aria-expanded={open} onClick={() => setOpen(o => !o)}>
              <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 18 }} />
            </IconButton>
          )}
        </Box>
      </Row>
      {open && hasError && (
        <Box sx={{ px: 4.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' }}>
          <Typography variant='body2' color='error' sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
            {task.last_error}
          </Typography>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
            {relativeTime(task.last_error_at, nowMs, locale)}
          </Typography>
        </Box>
      )}
    </>
  )
}

function OrchestratorSection({ orchestrator, nowMs }: Readonly<{ orchestrator: OrchestratorStatus | null; nowMs: number }>) {
  const t = useTranslations('platformStatus')
  const columns = 'minmax(220px, 1fr) 80px 160px 90px 150px 150px 40px'

  if (!orchestrator) {
    return (
      <Section icon='ri-settings-3-line' title={t('orchestrator.title')}>
        <Alert severity='error'>{t('orchestrator.unreachable')}</Alert>
      </Section>
    )
  }

  const pool = orchestrator.db_pool
  const tasks = sortTasks(orchestrator.tasks)

  return (
    <Section icon='ri-settings-3-line' title={t('orchestrator.title')}>
      <Box sx={STATS_SX}>
        <Stat icon='ri-price-tag-3-line' label={t('orchestrator.instance')} value={orchestrator.hostname || DASH} />
        {orchestrator.leader !== undefined && (
          <Stat icon='ri-vip-crown-line' label={t('orchestrator.role')} value={orchestrator.leader ? t('orchestrator.leader') : t('orchestrator.follower')} />
        )}
        <Stat icon='ri-git-merge-line' label={t('orchestrator.goroutines')} value={orchestrator.runtime.goroutines} />
        <Stat icon='ri-stack-line' label={t('orchestrator.heap')} value={formatBytes(orchestrator.runtime.heap_alloc_bytes, 1)} />
        {pool && <Stat icon='ri-plug-line' label={t('orchestrator.pool')} value={`${pool.in_use} / ${pool.max_open > 0 ? pool.max_open : pool.open}`} />}
        {pool && <Stat icon='ri-hourglass-line' label={t('orchestrator.poolWaits')} value={pool.wait_count} />}
        <Stat icon='ri-code-s-slash-line' label={t('orchestrator.goVersion')} value={orchestrator.runtime.go_version} />
      </Box>
      <TableScroll minWidth={960}>
      <Row columns={columns} header>
        <Head>{t('tasks.task')}</Head>
        <Head>{t('tasks.schedule')}</Head>
        <Head>{t('tasks.lastRun')}</Head>
        <Head right>{t('tasks.duration')}</Head>
        <Head right>{t('tasks.failures')}</Head>
        <Head>{t('tasks.status')}</Head>
        <Head />
      </Row>
      <PagedRows items={tasks} testId='platform-tasks-pager'>
        {task => <TaskRow key={task.name} task={task} nowMs={nowMs} columns={columns} />}
      </PagedRows>
      </TableScroll>
    </Section>
  )
}

function RetentionSection({ retention }: Readonly<{ retention: Record<string, number> }>) {
  const t = useTranslations('platformStatus')
  const columns = 'minmax(220px, 1fr) 140px'
  const entries = Object.entries(retention).sort(([a], [b]) => a.localeCompare(b))

  if (entries.length === 0) return null

  return (
    <Section icon='ri-history-line' title={t('retention.title')}>
      <Row columns={columns} header>
        <Head>{t('retention.data')}</Head>
        <Head right>{t('retention.kept')}</Head>
      </Row>
      {entries.map(([key, days]) => (
        <Row key={key} columns={columns}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <i className='ri-archive-line' style={{ fontSize: 16, opacity: 0.7, flexShrink: 0 }} />
            <Typography variant='body2' noWrap>
              {t.has(`retention.sets.${key}`) ? t(`retention.sets.${key}`) : key}
            </Typography>
          </Box>
          <Cell right muted>
            {t('retention.days', { days })}
          </Cell>
        </Row>
      ))}
    </Section>
  )
}

type View = 'overview' | 'database' | 'orchestrator'

export default function PlatformStatusTab() {
  const t = useTranslations('platformStatus')
  const locale = useLocale()
  const [view, setView] = useState<View>('overview')
  const { data, error, isLoading, isValidating, mutate } = useSWRFetch<PlatformStatus>(STATUS_URL, {
    refreshInterval: REFRESH_MS,
    revalidateOnFocus: true
  })

  if (isLoading && !data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={28} aria-label={t('loading')} />
      </Box>
    )
  }

  if (!data) return <Alert severity='error'>{t('loadError')}</Alert>

  const nowMs = Date.parse(data.generatedAt)
  const overallSeverity = data.overall === 'up' ? 'success' : data.overall === 'degraded' ? 'warning' : 'error'
  const enterprise = data.edition === 'enterprise'
  // In high availability the figures below the node list are those of the
  // one node that answered: name it.
  const here = data.ha ? data.frontend.hostname : null
  // A Community install has no orchestrator view to stand on.
  const current: View = view === 'orchestrator' && !enterprise ? 'overview' : view

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Chip size='small' color={overallSeverity} label={t(`overall.${data.overall}`)} />
        <Typography variant='body2' color='text.secondary' sx={{ flex: 1 }}>
          {t('summary', {
            version: data.frontend.version,
            host: data.frontend.hostname,
            time: new Intl.DateTimeFormat(locale, { timeStyle: 'medium' }).format(nowMs)
          })}
        </Typography>
        <Tooltip title={t('refresh')}>
          <span>
            <IconButton size='small' aria-label={t('refresh')} onClick={() => void mutate()} disabled={isValidating}>
              <i className='ri-refresh-line' style={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {error && <Alert severity='warning'>{t('staleError')}</Alert>}

      <Tabs value={current} onChange={(_e, v: View) => setView(v)} sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}>
        <Tab value='overview' label={t('views.overview')} sx={{ minHeight: 40 }} />
        <Tab value='database' label={t('views.database')} sx={{ minHeight: 40 }} />
        {enterprise && <Tab value='orchestrator' label={t('views.orchestrator')} sx={{ minHeight: 40 }} />}
      </Tabs>

      {current === 'overview' && (
        <>
          {data.ha && <HaNodesSection ha={data.ha} />}
          <ServicesSection services={data.services} node={here} />
          <HostSection host={data.host} disks={data.disks} node={here} />
          <FrontendSection frontend={data.frontend} />
          {data.orchestrator && <RetentionSection retention={data.orchestrator.retention ?? {}} />}
        </>
      )}
      {current === 'database' && <DatabaseSection database={data.database} nowMs={nowMs} />}
      {current === 'orchestrator' && <OrchestratorSection orchestrator={data.orchestrator} nowMs={nowMs} />}
    </Box>
  )
}
