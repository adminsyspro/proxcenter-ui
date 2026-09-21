'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton,
  InputAdornment, LinearProgress, MenuItem, Select, Stack, TablePagination, TextField, Tooltip, Typography,
  alpha, useTheme
} from '@mui/material'

import { AreaChart, Area, YAxis, Tooltip as RTooltip } from 'recharts'
import ChartContainer from '@/components/ChartContainer'

import EngineGlyph from './EngineGlyph'
import AppDialogTitle from '@/components/ui/AppDialogTitle'
import EmptyState from '@/components/EmptyState'

import type { ReplicationJob, ReplicationJobStatus, ReplicationJobLog, StorageEngine } from '@/lib/orchestrator/site-recovery.types'
import { scheduleToLabel } from './schedule/scheduleToLabel'
import { copyToClipboard } from '@/lib/clipboard'

// ── Helpers ────────────────────────────────────────────────────────────

function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))

  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatDuration(seconds: number | undefined | null): string {
  if (seconds == null || Number.isNaN(seconds)) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`

  return `${(seconds / 3600).toFixed(1)}h`
}

function computeRpoActual(lastSync: string | null | undefined): number | null {
  if (!lastSync) return null
  const diff = Math.floor((Date.now() - new Date(lastSync).getTime()) / 1000)
  return diff > 0 ? diff : null
}

// Per-VM replication state as a glyph, shown at the end of the row. Must stay
// in step with the siteRecovery.status catalogue that names it in the tooltip.
function vmStatusIcon(status: string): string {
  switch (status) {
    case 'synced': return 'ri-checkbox-circle-line'
    case 'syncing': return 'ri-refresh-line'
    case 'error':
    case 'reseed_required':
    case 'source_missing': return 'ri-error-warning-line'
    case 'skipped': return 'ri-pause-circle-line'
    case 'suspended': return 'ri-pause-circle-line'
    default: return 'ri-time-line'
  }
}

function jobLabel(job: ReplicationJob, vmNameMap?: Record<number, string>): string {
  const tags = job.tags || []
  const ids = job.vm_ids || []

  // Tag-based jobs: show tags + VM count
  if (tags.length > 0) {
    const tagStr = tags.map(t => `#${t}`).join(', ')
    return `${tagStr} (${ids.length} VM${ids.length !== 1 ? 's' : ''})`
  }

  if (ids.length === 0) return 'Replication Job'

  const labels = ids.map(id => {
    const name = vmNameMap?.[id] || (job.vm_names || [])[ids.indexOf(id)]
    return name ? `${id} - ${name}` : `VM ${id}`
  })

  if (labels.length <= 3) return labels.join(', ')
  return `${ids.length} VMs (${labels.slice(0, 2).join(', ')}…)`
}

// ── Sub-components ─────────────────────────────────────────────────────

const StatusChip = ({ status, t }: { status: ReplicationJobStatus; t: any }) => {
  const config: Record<ReplicationJobStatus, { label: string; color: 'success' | 'primary' | 'error' | 'default' | 'warning'; icon?: string }> = {
    synced: { label: t('siteRecovery.status.synced'), color: 'success' },
    syncing: { label: t('siteRecovery.status.syncing'), color: 'primary' },
    error: { label: t('siteRecovery.status.error'), color: 'error' },
    paused: { label: t('siteRecovery.status.paused'), color: 'default' },
    pending: { label: t('siteRecovery.status.pending'), color: 'warning' },
    failed_over: { label: t('siteRecovery.jobs.failedOver'), color: 'warning', icon: 'ri-shield-star-line' },
    no_match: { label: t('siteRecovery.status.noMatch'), color: 'warning', icon: 'ri-price-tag-3-line' },
    partial: { label: t('siteRecovery.status.partial'), color: 'warning', icon: 'ri-error-warning-line' }
  }

  const c = config[status] || config.paused

  return (
    <Chip
      size='small'
      label={c.label}
      color={c.color}
      variant={status === 'paused' ? 'outlined' : 'filled'}
      icon={c.icon ? <i className={c.icon} /> : undefined}
    />
  )
}

const DetailRow = ({ icon, label, value, mono }: { icon: string; label: string; value: string; mono?: boolean }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.25 }}>
    <Box sx={{ width: 32, height: 32, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', fontSize: '0.9rem' }}>
      <i className={icon} />
    </Box>
    <Box sx={{ flex: 1 }}>
      <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block' }}>{label}</Typography>
      <Typography variant='body2' sx={{ fontWeight: 600, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</Typography>
    </Box>
  </Box>
)

type ThroughputPoint = { ts: number; bps: number }

const BandwidthSparkline = ({ data, size = 'small' }: { data: ThroughputPoint[]; size?: 'small' | 'large' }) => {
  const theme = useTheme()
  const color = theme.palette.primary.main
  const isLarge = size === 'large'
  const gradientId = `bwGrad-${size}-${data[0]?.ts || 0}`
  // Shallow copy — recharts may mutate the array internally (React 19 freezes props)
  const chartData = data.slice()

  return (
    <Box sx={{ width: isLarge ? '100%' : 80, height: isLarge ? 120 : 24, flexShrink: 0, minWidth: 0, minHeight: 0 }}>
      <ChartContainer>
        <AreaChart data={chartData} margin={isLarge ? { top: 4, right: 4, left: 4, bottom: 4 } : { top: 2, right: 2, left: 2, bottom: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor={color} stopOpacity={0.3} />
              <stop offset='100%' stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          {isLarge && (
            <RTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null
                const p = payload[0].payload as ThroughputPoint

                return (
                  <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 0.75, boxShadow: 2 }}>
                    <Typography variant='caption' sx={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>
                      {formatBytes(p.bps)}/s
                    </Typography>
                    <Typography variant='caption' sx={{ display: 'block', color: 'text.secondary', fontSize: '0.6rem' }}>
                      {new Date(p.ts).toLocaleTimeString()}
                    </Typography>
                  </Box>
                )
              }}
              cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: '3 3' }}
            />
          )}
          <Area
            type='monotone'
            dataKey='bps'
            stroke={color}
            strokeWidth={isLarge ? 1.5 : 1}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </Box>
  )
}

const JobCard = ({ job, onClick, onEdit, vmNameMap, throughputHistory, t }: { job: ReplicationJob; onClick: () => void; onEdit: () => void; vmNameMap?: Record<number, string>; throughputHistory?: ThroughputPoint[]; t: any }) => {
  const theme = useTheme()
  const progress = job.progress_percent || 0
  const isError = job.status === 'error'
  const isSyncing = job.status === 'syncing'
  const isFailedOver = job.status === 'failed_over'
  const rpoActual = computeRpoActual(job.last_sync)
  const rpoOk = rpoActual != null && rpoActual <= job.rpo_target

  const flowGradient = `linear-gradient(90deg, transparent 0%, transparent 30%, ${alpha(theme.palette.primary.main, 0.12)} 50%, transparent 70%, transparent 100%)`

  return (
    <Card
      variant='outlined'
      onClick={onClick}
      sx={{
        borderRadius: 1.5, cursor: 'pointer', transition: 'all 0.2s ease',
        borderColor: isError ? 'error.main' : isSyncing ? 'primary.main' : 'divider',
        position: 'relative', overflow: 'hidden',
        '&:hover': { borderColor: isError ? 'error.light' : 'primary.main', bgcolor: 'action.hover' },
        // Progress fill
        ...(isSyncing ? {
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0, left: 0,
            height: '100%',
            width: `${progress}%`,
            bgcolor: 'primary.main',
            opacity: 0.07,
            transition: 'width 1.5s ease',
            zIndex: 0,
          },
          // Animated data flow sweep (left → right)
          '&::after': {
            content: '""',
            position: 'absolute',
            top: 0, left: '-100%',
            height: '100%',
            width: '100%',
            background: flowGradient,
            animation: 'dataFlow 2s ease-in-out infinite',
            zIndex: 0,
          },
          '@keyframes dataFlow': {
            '0%': { left: '-100%' },
            '100%': { left: '100%' },
          },
        } : {})
      }}
    >
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, position: 'relative', zIndex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
            <EngineGlyph engine={job.storage_engine} />
            <Box component='span' sx={{ position: 'absolute', bottom: -1, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: isError ? 'error.main' : isSyncing ? 'primary.main' : job.status === 'synced' ? 'success.main' : 'text.disabled', border: '1.5px solid', borderColor: 'background.paper' }} />
          </Box>

          {/* Sync icon */}
          {isSyncing && (
            <Box sx={{
              display: 'flex', alignItems: 'center', color: 'primary.main',
              animation: 'spin 1.5s linear infinite',
              '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
              fontSize: '1rem', flexShrink: 0,
            }}>
              <i className='ri-loader-4-line' />
            </Box>
          )}

          {/* The job's name carries the row. The guests it protects are listed,
              with their own state, in the details dialog: spelling them out here
              too pushed the row towards an unreadable enumeration as soon as a
              job grew. A job with no name falls back to the derived label, which
              is then its only identifier. */}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
            {job.name ? (
              <Typography variant='body2' sx={{
                fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.5, lineHeight: 1.25,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                <i className='ri-bookmark-line' style={{ fontSize: 14, opacity: 0.7 }} />
                {job.name}
              </Typography>
            ) : (
              <Typography variant='body2' sx={{
                fontWeight: 600, color: 'text.primary',
                display: 'block', lineHeight: 1.3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {jobLabel(job, vmNameMap)}
              </Typography>
            )}
          </Box>

          {/* Syncing progress + throughput + sparkline */}
          {isSyncing && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
              {throughputHistory && throughputHistory.length >= 2 && (
                <BandwidthSparkline data={throughputHistory} size='small' />
              )}
              <Typography variant='caption' sx={{ color: 'primary.main', fontWeight: 700, fontSize: '0.75rem' }}>
                {progress > 0 ? `${Math.round(progress)}%` : '…'}
                {job.throughput_bps > 0 && <span style={{ fontWeight: 500, marginLeft: 6, opacity: 0.7 }}>{formatBytes(job.throughput_bps)}/s</span>}
              </Typography>
            </Box>
          )}

          {/* RPO */}
          {!isSyncing && (
            <Box sx={{ textAlign: 'center', minWidth: 60, display: { xs: 'none', sm: 'block' } }}>
              <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>RPO</Typography>
              <Typography variant='body2' sx={{ fontWeight: 600, fontSize: '0.75rem', color: rpoOk ? 'success.main' : 'text.secondary' }}>
                {formatDuration(rpoActual)}
              </Typography>
            </Box>
          )}

          {/* Last Sync */}
          {!isSyncing && (
            <Box sx={{ textAlign: 'center', minWidth: 100, display: { xs: 'none', md: 'block' } }}>
              <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>{t('siteRecovery.protection.lastSync')}</Typography>
              <Typography variant='body2' sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                {job.last_sync ? new Date(job.last_sync).toLocaleString() : '—'}
              </Typography>
            </Box>
          )}

          {/* Next Sync */}
          {!isSyncing && (
            <Box sx={{ textAlign: 'center', minWidth: 100, display: { xs: 'none', md: 'block' } }}>
              <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>{t('siteRecovery.protection.nextSync')}</Typography>
              <Typography variant='body2' sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                {job.next_sync && job.status !== 'paused' ? new Date(job.next_sync).toLocaleString() : '—'}
              </Typography>
            </Box>
          )}

          {/* Status + retry indicator */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25 }}>
            <StatusChip status={job.status} t={t} />
            {job.status === 'error' && job.next_retry_at && (job.retry_count || 0) < 3 && (
              <Tooltip title={t('siteRecovery.protection.retryTooltip', { count: job.retry_count, max: 3, at: new Date(job.next_retry_at).toLocaleString() })} arrow>
                <Chip
                  size='small'
                  icon={<i className='ri-refresh-line' style={{ fontSize: 12 }} />}
                  label={t('siteRecovery.protection.retryBadge', { count: job.retry_count, max: 3, in: formatDuration(Math.max(0, Math.round((new Date(job.next_retry_at).getTime() - Date.now()) / 1000))) })}
                  variant='outlined'
                  sx={{ height: 18, fontSize: '0.6rem', borderColor: 'warning.main', color: 'warning.main' }}
                />
              </Tooltip>
            )}
          </Box>

          {/* Edit (does not open the drawer) */}
          <Tooltip title={isFailedOver ? t('siteRecovery.jobs.failedOverTooltip') : t('common.edit')} arrow>
            <span>
              <IconButton
                size='small'
                disabled={isFailedOver}
                aria-label={t('common.edit')}
                onClick={e => { e.stopPropagation(); onEdit() }}
                sx={{ p: 0.5, color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
              >
                <i className='ri-edit-line' style={{ fontSize: 16 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </CardContent>

      {/* Bottom progress bar */}
      {isSyncing && (
        <LinearProgress
          variant='determinate'
          value={progress}
          sx={{ height: 3, position: 'absolute', bottom: 0, left: 0, right: 0 }}
        />
      )}
    </Card>
  )
}

// jobsByEngine splits the jobs of one cluster pair by storage engine, Ceph first,
// so mixed pairs get one section per engine; a single-engine pair stays flat.
export function jobsByEngine(jobs: ReplicationJob[]): Array<[StorageEngine, ReplicationJob[]]> {
  const engines: StorageEngine[] = ['rbd', 'zfs']
  return engines
    .map(engine => [engine, jobs.filter(j => (j.storage_engine || 'rbd') === engine)] as [StorageEngine, ReplicationJob[]])
    .filter(([, list]) => list.length > 0)
}

// ── Main Component ─────────────────────────────────────────────────────

interface Connection {
  id: string
  name: string
}

interface ProtectionTabProps {
  jobs: ReplicationJob[]
  loading: boolean
  logs: ReplicationJobLog[]
  logsLoading: boolean
  connections: Connection[]
  vmNamesByConn?: Record<string, Record<number, string>>
  onSyncJob: (id: string) => void
  onPauseJob: (id: string) => void
  onResumeJob: (id: string) => void
  onDeleteJob: (id: string) => void
  onEditJob: (id: string) => void
  selectedJobId: string | null
  onSelectJob: (id: string | null) => void
}

export default function ProtectionTab({
  jobs, loading, logs, logsLoading, connections, vmNamesByConn,
  onSyncJob, onPauseJob, onResumeJob, onDeleteJob, onEditJob,
  selectedJobId, onSelectJob
}: ProtectionTabProps) {
  const t = useTranslations()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmDeleteJob, setConfirmDeleteJob] = useState<ReplicationJob | null>(null)
  type VMStatusRow = {
    job_id: string
    vmid: number
    vm_name?: string
    // suspended: a test failover is running on this guest's replica, so the job
    // skips it and keeps replicating its siblings.
    status: 'pending' | 'syncing' | 'synced' | 'error' | 'suspended' | 'skipped' | 'reseed_required' | 'source_missing'
    last_sync?: string | null
    last_error?: string
    bytes_sent: number
    duration_ms: number
    updated_at: string
  }
  const [vmStatuses, setVmStatuses] = useState<VMStatusRow[] | null>(null)
  const [reseedGuest, setReseedGuest] = useState<{ jobId: string; vmid: number; name: string } | null>(null)
  const [reseedBusy, setReseedBusy] = useState(false)
  const [reseedError, setReseedError] = useState('')
  const [reseedQueued, setReseedQueued] = useState(false)
  // Guests whose re-seed the orchestrator accepted but has not started yet:
  // the 15 s poll still reports them reseed_required, and the button must not
  // offer the destructive wipe a second time meanwhile.
  const [reseedQueuedVmids, setReseedQueuedVmids] = useState<Set<number>>(new Set())

  const confirmReseed = async () => {
    if (!reseedGuest || reseedBusy) return
    setReseedBusy(true)
    setReseedError('')
    try {
      const response = await fetch(`/api/v1/orchestrator/replication/jobs/${encodeURIComponent(reseedGuest.jobId)}/vms/${reseedGuest.vmid}/reseed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
      })
      // An accepted 202 may carry no body, and a proxy error page is not JSON:
      // neither must read as "the re-seed failed" and invite a retry.
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || t('siteRecovery.protection.reseedFailed'))
      setVmStatuses(rows => rows?.map(row => row.vmid === reseedGuest.vmid ? { ...row, status: 'pending', last_error: '' } : row) ?? null)
      setReseedQueuedVmids(prev => new Set(prev).add(reseedGuest.vmid))
      setReseedGuest(null)
      setReseedQueued(true)
    } catch (error) {
      setReseedError(error instanceof Error ? error.message : t('siteRecovery.protection.reseedFailed'))
    } finally {
      setReseedBusy(false)
    }
  }
  // Five rows a page keeps the block a fixed height, so the dialog itself
  // never scrolls however many guests a tag-based job ends up carrying.
  const VM_ROWS_PER_PAGE = 5
  const [vmPage, setVmPage] = useState(0)
  const [vmStatusesLoading, setVmStatusesLoading] = useState(false)

  // Historical throughput from the server
  type ThroughputSample = { timestamp: string; bytes_per_sec: number }
  const [thSamples, setThSamples] = useState<ThroughputSample[] | null>(null)
  const [thLoading, setThLoading] = useState(false)
  const [thWindow, setThWindow] = useState<'1h' | '6h' | '24h' | '7d'>('24h')

  // Throughput history — persisted in localStorage, 24h rolling window
  const STORAGE_KEY = 'sr-throughput-history'
  const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24h

  const throughputHistoryRef = useRef<Map<string, ThroughputPoint[]>>(null as any)
  const [, forceUpdate] = useState(0)

  // Hydrate from localStorage once on mount
  if (throughputHistoryRef.current === null) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed: Record<string, ThroughputPoint[]> = JSON.parse(raw)
        const now = Date.now()
        const map = new Map<string, ThroughputPoint[]>()

        for (const [id, pts] of Object.entries(parsed)) {
          const fresh = pts.filter(p => now - p.ts < MAX_AGE_MS)
          if (fresh.length > 0) map.set(id, fresh)
        }

        throughputHistoryRef.current = map
      } else {
        throughputHistoryRef.current = new Map()
      }
    } catch {
      throughputHistoryRef.current = new Map()
    }
  }

  useEffect(() => {
    const map = throughputHistoryRef.current
    const now = Date.now()

    for (const job of jobs || []) {
      if (job.status === 'syncing' && job.throughput_bps > 0) {
        if (!map.has(job.id)) map.set(job.id, [])
        const arr = map.get(job.id)!
        const last = arr[arr.length - 1]

        // Only push if enough time has passed (>2s) to avoid duplicates
        if (!last || now - last.ts > 2000) {
          arr.push({ ts: now, bps: job.throughput_bps })

          // Trim entries older than 24h
          while (arr.length > 0 && now - arr[0].ts > MAX_AGE_MS) arr.shift()
        }
      }
      // Don't delete history when sync stops — keep it for the graph
    }

    // Persist to localStorage
    try {
      const obj: Record<string, ThroughputPoint[]> = {}
      for (const [id, pts] of map) obj[id] = pts
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
    } catch { /* storage full — non-critical */ }

    forceUpdate(n => n + 1)
  }, [jobs])

  const connMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of connections || []) m[c.id] = c.name
    return m
  }, [connections])

  const connName = (id: string) => connMap[id] || id

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()

    return (jobs || []).filter(j => {
      const label = jobLabel(j, vmNamesByConn?.[j.source_cluster])
      const matchQ = !qq || label.toLowerCase().includes(qq) ||
        (j.name || '').toLowerCase().includes(qq) ||
        connName(j.source_cluster).toLowerCase().includes(qq) || connName(j.target_cluster).toLowerCase().includes(qq)

      return matchQ && (statusFilter === 'all' || j.status === statusFilter)
    })
  }, [jobs, q, statusFilter, connName, vmNamesByConn])

  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1))
  const grouped = useMemo(() => {
    const map = new Map<string, ReplicationJob[]>()

    for (const job of filtered.slice(currentPage * 25, currentPage * 25 + 25)) {
      const key = `${job.source_cluster}::${job.target_cluster}`

      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(job)
    }

    return map
  }, [filtered, currentPage])

  const selected = useMemo(() => (jobs || []).find(j => j.id === selectedJobId), [jobs, selectedJobId])

  const openJob = (id: string) => {
    onSelectJob(id)
    setDrawerOpen(true)
    setVmPage(0)
    setReseedQueued(false)
    setReseedQueuedVmids(new Set())
  }

  // Fetch per-VM status when the drawer opens on a job that protects anything.
  // A single-guest job gets the table too: its own last run, volume and duration
  // live there and nowhere else.
  useEffect(() => {
    if (!drawerOpen || !selectedJobId) {
      setVmStatuses(null)
      return
    }
    const job = (jobs || []).find(j => j.id === selectedJobId)
    if (!job || (job.vm_ids || []).length === 0) {
      setVmStatuses(null)
      return
    }
    let cancelled = false
    setVmStatusesLoading(true)
    fetch(`/api/v1/orchestrator/replication/jobs/${selectedJobId}/vms`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        if (cancelled) return
        const rows: VMStatusRow[] = Array.isArray(data) ? data : []
        setVmStatuses(rows)
        // The orchestrator confirms a queued re-seed by moving the row off
        // reseed_required; until then the button stays locked.
        setReseedQueuedVmids(prev => {
          const next = new Set([...prev].filter(vmid => rows.some(row => row.vmid === vmid && row.status === 'reseed_required')))
          return next.size === prev.size ? prev : next
        })
      })
      .catch(() => { if (!cancelled) setVmStatuses([]) })
      .finally(() => { if (!cancelled) setVmStatusesLoading(false) })
    return () => { cancelled = true }
  }, [drawerOpen, selectedJobId, jobs])

  // Fetch throughput history when drawer opens or window changes
  useEffect(() => {
    if (!drawerOpen || !selectedJobId) {
      setThSamples(null)
      return
    }
    let cancelled = false
    setThLoading(true)
    fetch(`/api/v1/orchestrator/replication/jobs/${selectedJobId}/throughput?window=${thWindow}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : []))
      .then(data => { if (!cancelled) setThSamples(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setThSamples([]) })
      .finally(() => { if (!cancelled) setThLoading(false) })
    return () => { cancelled = true }
  }, [drawerOpen, selectedJobId, thWindow])

  const closeDrawer = () => {
    setDrawerOpen(false)
    onSelectJob(null)
  }

  const copyLogs = useCallback(async () => {
    if (!logs || logs.length === 0) return
    const text = logs.map(l => `[${new Date(l.created_at).toLocaleTimeString()}] [${l.level}] ${l.message}`).join('\n')
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [logs])

  const formatRPO = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
    return `${Math.round(seconds / 86400)}d`
  }

  const planningLabel = (j: typeof jobs[0]) => {
    if (j.schedule_spec) {
      return scheduleToLabel(j.schedule_spec, j.timezone || '', t)
    }
    return `${t('siteRecovery.rpoTargetLabel')}: ${formatRPO(j.rpo_target)}`
  }

  if (loading) {
    return (
      <Stack spacing={2}>
        {[1, 2, 3, 4].map(i => (
          <Card key={i} variant='outlined' sx={{ borderRadius: 2, height: 120 }}>
            <CardContent><LinearProgress /></CardContent>
          </Card>
        ))}
      </Stack>
    )
  }

  return (
    <Box>
      {/* Filter Bar */}
      <Card variant='outlined' sx={{ borderRadius: 2, mb: 2 }}>
        <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              value={q}
              onChange={e => { setQ(e.target.value); setPage(0) }}
              placeholder={t('siteRecovery.protection.searchPlaceholder')}
              size='small'
              sx={{ flex: 1, minWidth: 200 }}
              InputProps={{ startAdornment: <InputAdornment position='start'><i className='ri-search-line' style={{ opacity: 0.5 }} /></InputAdornment> }}
            />
            <Select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }} size='small' sx={{ minWidth: 140 }}>
              <MenuItem value='all'>{t('siteRecovery.status.all')}</MenuItem>
              <MenuItem value='synced'>{t('siteRecovery.status.synced')}</MenuItem>
              <MenuItem value='syncing'>{t('siteRecovery.status.syncing')}</MenuItem>
              <MenuItem value='paused'>{t('siteRecovery.status.paused')}</MenuItem>
              <MenuItem value='error'>{t('siteRecovery.status.error')}</MenuItem>
              <MenuItem value='no_match'>{t('siteRecovery.status.noMatch')}</MenuItem>
              <MenuItem value='partial'>{t('siteRecovery.status.partial')}</MenuItem>
            </Select>
            {(q || statusFilter !== 'all') && (
              <Button size='small' onClick={() => { setQ(''); setStatusFilter('all') }} startIcon={<i className='ri-close-line' />}>
                {t('common.reset')}
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Jobs List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon=''
          title={(jobs || []).length === 0 ? t('siteRecovery.protection.noJobs') : t('siteRecovery.protection.noJobFound')}
          description={(jobs || []).length === 0 ? t('siteRecovery.protection.noJobsDesc') : t('siteRecovery.protection.noJobFoundDesc')}
          size='large'
        />
      ) : (
        <Stack spacing={0}>
          {Array.from(grouped.entries()).map(([key, groupJobs], groupIndex) => {
            const [sourceId, targetId] = key.split('::')

            return (
              <Box key={key}>
                {/* Group header */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, mt: groupIndex > 0 ? 2.5 : 0 }}>
                  <i className='ri-server-line' style={{ opacity: 0.5 }} />
                  <Typography variant='subtitle2' sx={{ fontWeight: 600 }}>
                    {connName(sourceId)} → {connName(targetId)}
                  </Typography>
                  <Chip size='small' label={`${groupJobs.length} job${groupJobs.length > 1 ? 's' : ''}`} variant='outlined' sx={{ height: 20, fontSize: '0.65rem' }} />
                </Box>
                {/* Group jobs, one section per storage engine when the pair mixes them */}
                {(() => {
                  const sections = jobsByEngine(groupJobs)
                  return sections.map(([engine, list]) => (
                    <Box key={engine} sx={{ mb: sections.length > 1 ? 1.5 : 0 }}>
                      {sections.length > 1 && (
                        <Divider textAlign='center' role='separator' aria-label={t(`siteRecovery.engine.${engine}`)} sx={{ mb: 1 }}>
                          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                            <EngineGlyph engine={engine} size={14} />
                            <Typography variant='caption' sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                              {t(`siteRecovery.engine.${engine}`)}
                            </Typography>
                            <Chip size='small' label={list.length} variant='outlined' sx={{ height: 18, fontSize: '0.6rem' }} />
                          </Box>
                        </Divider>
                      )}
                      <Stack spacing={1}>
                        {list.map(j => (
                          <JobCard key={j.id} job={j} onClick={() => openJob(j.id)} onEdit={() => onEditJob(j.id)} vmNameMap={vmNamesByConn?.[j.source_cluster]} throughputHistory={throughputHistoryRef.current.get(j.id)} t={t} />
                        ))}
                      </Stack>
                    </Box>
                  ))
                })()}
              </Box>
            )
          })}
        </Stack>
      )}

      {filtered.length > 25 && <TablePagination component='div' count={filtered.length} page={currentPage} rowsPerPage={25} rowsPerPageOptions={[25]} onPageChange={(_, value) => setPage(value)} />}

      {/* Job details. A centred dialog rather than the 450 px side drawer this
          replaces: the per-VM list, the bandwidth chart and the log lines each
          want width, and stacking them in a narrow column turned the panel into
          one long scroll. Below sm the Paper takes the whole screen, where a
          centred box would only lose its margins. */}
      <Dialog
        open={drawerOpen}
        onClose={closeDrawer}
        fullWidth
        maxWidth='lg'
        PaperProps={{
          sx: {
            m: { xs: 0, sm: 4 },
            width: { xs: '100%', sm: 'auto' },
            maxWidth: { xs: '100%', sm: 1180 },
            height: { xs: '100%', sm: 'auto' },
            maxHeight: { sm: '90vh' },
            borderRadius: { xs: 0, sm: 1 }
          }
        }}
      >
        {!selected ? (
          <Box sx={{ p: 2.5 }}>
            <Alert severity='info'>{t('siteRecovery.protection.selectJob')}</Alert>
          </Box>
        ) : (
          <>
            {/* The shared dialog header, as everywhere else in the app. The job
                name alone: the guests it carries are listed with their state
                further down, and repeating them here said the same thing three
                times over. */}
            <AppDialogTitle
              icon={<EngineGlyph engine={selected.storage_engine} size={24} />}
              onClose={closeDrawer}
            >
              <Box component='span' sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75, minWidth: 0, maxWidth: '100%' }}>
                <Box component='span' sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selected.name || jobLabel(selected, vmNamesByConn?.[selected.source_cluster])}
                </Box>
                {/* The engine reads off the existing siteRecovery.engine catalogue,
                    the same wording the create dialog uses, rather than a second
                    hard-coded spelling of "Ceph RBD". */}
                <Box component='span' sx={{ flexShrink: 0, color: 'text.secondary', fontWeight: 400 }}>
                  - {t(`siteRecovery.engine.${selected.storage_engine}`)} {t('siteRecovery.tabs.replication')}
                </Box>
              </Box>
            </AppDialogTitle>
            <Box sx={{ px: 2.5, pb: 2.5, pt: 0.5, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

              {/* Actions as icon buttons, the tooltip carries the label: four
                  labelled buttons crowd the row once the status chip claims its
                  right end ("Synchroniser" alone is wider than a quarter of it).
                  A disabled button fires no events, hence the span under its
                  Tooltip. */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <Tooltip title={selected.status === 'failed_over' ? t('siteRecovery.jobs.failedOverTooltip') : t('siteRecovery.protection.syncNow')} arrow>
                  <span>
                    <IconButton color='primary' aria-label={t('siteRecovery.protection.syncNow')} onClick={() => onSyncJob(selected.id)} disabled={selected.status === 'failed_over'}>
                      <i className='ri-refresh-line' />
                    </IconButton>
                  </span>
                </Tooltip>
                {selected.status === 'failed_over' ? (
                  <Tooltip title={t('siteRecovery.jobs.failedOverTooltip')} arrow>
                    <span>
                      <IconButton aria-label={t('siteRecovery.protection.resume')} disabled><i className='ri-play-circle-line' /></IconButton>
                    </span>
                  </Tooltip>
                ) : selected.status === 'paused' ? (
                  <Tooltip title={t('siteRecovery.protection.resume')} arrow>
                    <IconButton aria-label={t('siteRecovery.protection.resume')} onClick={() => onResumeJob(selected.id)}><i className='ri-play-circle-line' /></IconButton>
                  </Tooltip>
                ) : (
                  <Tooltip title={t('siteRecovery.protection.pause')} arrow>
                    <IconButton aria-label={t('siteRecovery.protection.pause')} onClick={() => onPauseJob(selected.id)}><i className='ri-pause-line' /></IconButton>
                  </Tooltip>
                )}
                <Tooltip title={selected.status === 'failed_over' ? t('siteRecovery.jobs.failedOverTooltip') : t('common.edit')} arrow>
                  <span>
                    <IconButton aria-label={t('common.edit')} onClick={() => onEditJob(selected.id)} disabled={selected.status === 'failed_over'}>
                      <i className='ri-edit-line' />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t('common.delete')} arrow>
                  <IconButton color='error' aria-label={t('common.delete')} onClick={() => setConfirmDeleteJob(selected)}><i className='ri-delete-bin-line' /></IconButton>
                </Tooltip>
                <Box sx={{ ml: 'auto' }}>
                  <StatusChip status={selected.status} t={t} />
                </Box>
              </Box>

              {(selected.status === 'error' || selected.status === 'partial') && selected.error_message && (
                <Alert severity={selected.status === 'partial' ? 'warning' : 'error'} sx={{ mb: 2 }} icon={<i className='ri-error-warning-line' />}>{selected.error_message}</Alert>
              )}

              {/* Source and target side by side, so the layout carries the
                  direction on its own, joined edge to edge by the connector. */}
              <Box sx={{
                p: 2, borderRadius: 1, bgcolor: 'action.hover', mb: 2,
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, max-content) minmax(48px, 1fr) minmax(0, max-content)' },
                rowGap: { xs: 0.5, sm: 0 }
              }}>
                <Box sx={{ display: 'contents' }}>
                  <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', gridColumn: 1, gridRow: 1, textAlign: { xs: 'center', sm: 'left' } }}>
                    {t('siteRecovery.protection.source')}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, overflow: 'hidden', gridColumn: 1, gridRow: 2, justifyContent: { xs: 'center', sm: 'flex-start' } }}>
                    <EngineGlyph engine={selected.storage_engine} />
                    <Typography variant='body2' sx={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {connName(selected.source_cluster)}
                    </Typography>
                  </Box>
                </Box>

                <Box
                  aria-hidden
                  sx={{
                    display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center',
                    gridColumn: { xs: 1, sm: 2 }, gridRow: { xs: 3, sm: 2 },
                    justifySelf: { xs: 'center', sm: 'stretch' }, alignSelf: 'stretch',
                    width: { xs: 28, sm: 'auto' }, height: { xs: 38, sm: 'auto' },
                    color: selected.status === 'syncing' ? 'primary.main' : 'text.disabled'
                  }}
                >
                  {selected.status === 'syncing' ? (
                  <>
                  {/* Two identical binary runs make one continuous belt: moving
                      the belt by exactly half its width swaps one run for the
                      other, so the loop has neither a gap nor a visible seam. */}
                  <Box sx={{
                    position: 'relative', flex: 1, minWidth: 0,
                    width: { xs: 18, sm: 'auto' }, height: { xs: 30, sm: 16 },
                    overflow: 'hidden', display: 'flex', alignItems: 'center',
                    maskImage: {
                      xs: 'linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)',
                      sm: 'linear-gradient(to right, transparent 0%, rgba(0, 0, 0, 0.45) 7%, black 72%, black 95%, transparent 100%)'
                    },
                    WebkitMaskImage: {
                      xs: 'linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)',
                      sm: 'linear-gradient(to right, transparent 0%, rgba(0, 0, 0, 0.45) 7%, black 72%, black 95%, transparent 100%)'
                    }
                  }}>
                    <Box sx={{
                      display: 'inline-flex', width: 'max-content', flexShrink: 0,
                      fontFamily: 'monospace', fontSize: 9.5, fontWeight: 700,
                      lineHeight: 1, letterSpacing: '0.08em', whiteSpace: 'nowrap',
                      writingMode: { xs: 'vertical-rl', sm: 'horizontal-tb' },
                      textOrientation: { xs: 'upright', sm: 'mixed' },
                      animation: { xs: 'none', sm: `srBinaryFlow ${selected.status === 'syncing' ? '2.4s' : '8s'} linear infinite` },
                      filter: selected.status === 'syncing'
                        ? theme => `drop-shadow(0 0 3px ${alpha(theme.palette.primary.main, 0.55)})`
                        : 'none',
                      // Source to target, so the run starts shifted back by one
                      // copy and slides forward. Translating the other way made
                      // the digits read as travelling from the target to the
                      // source. Two identical copies, so -50% is exactly one
                      // run width and the loop has no seam.
                      '@keyframes srBinaryFlow': {
                        from: { transform: 'translate3d(-50%, 0, 0)' },
                        to: { transform: 'translate3d(0, 0, 0)' }
                      },
                      '@media (prefers-reduced-motion: reduce)': {
                        animation: 'none', transform: 'translate3d(0, 0, 0)'
                      },
                      '& > span': {
                        display: 'inline-block', flexShrink: 0,
                        backgroundImage: theme => {
                          const streamColor = selected.status === 'syncing' ? theme.palette.primary.main : theme.palette.text.disabled

                          return `linear-gradient(90deg, ${alpha(streamColor, 0.34)} 0%, ${alpha(streamColor, 0.72)} 18%, ${alpha(streamColor, 0.46)} 36%, ${alpha(streamColor, 0.9)} 57%, ${alpha(streamColor, 0.52)} 76%, ${streamColor} 100%)`
                        },
                        backgroundClip: 'text', WebkitBackgroundClip: 'text',
                        color: 'transparent'
                      }
                    }}>
                      <Box component='span'>0100111011010010110100011100101001110101100010110011010010111001011010001110100101101100011011010100111001011010011100101101000111010010</Box>
                      <Box component='span'>0100111011010010110100011100101001110101100010110011010010111001011010001110100101101100011011010100111001011010011100101101000111010010</Box>
                    </Box>
                  </Box>
                  </>
                  ) : (
                    /* At rest, a plain rule. Dimming the digits instead made
                       them depend on the theme: text.disabled is a light grey
                       on a dark ground but a dark one on a light ground, so
                       the same opacity that hid them in dark mode left them
                       plainly legible in light mode. */
                    <Box sx={{ flex: 1, minWidth: 0, width: { xs: 2, sm: 'auto' }, height: { xs: 30, sm: 2 }, borderRadius: 1, bgcolor: 'divider' }} />
                  )}
                  {/* The arrow head belongs to a transfer in progress. On an
                      idle job it pointed at nothing and read as a stray glyph. */}
                  {selected.status === 'syncing' && (
                    <Box sx={{ lineHeight: 0, ml: { sm: -0.25 }, mt: { xs: -0.25 }, fontSize: '1.1rem', transform: { xs: 'rotate(90deg)', sm: 'none' } }}>
                      <i className='ri-arrow-right-s-line' />
                    </Box>
                  )}
                </Box>

                <Box sx={{ display: 'contents' }}>
                  <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', gridColumn: { xs: 1, sm: 3 }, gridRow: { xs: 4, sm: 1 }, textAlign: { xs: 'center', sm: 'right' } }}>
                    {t('siteRecovery.protection.target')}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, overflow: 'hidden', gridColumn: { xs: 1, sm: 3 }, gridRow: { xs: 5, sm: 2 }, justifyContent: { xs: 'center', sm: 'flex-end' } }}>
                    <EngineGlyph engine={selected.storage_engine} />
                    <Typography variant='body2' sx={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {connName(selected.target_cluster)} / {selected.target_pool}{selected.storage_engine === 'zfs' && ` · ${selected.target_node || ''}`}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              {/* Two columns from md: the figures and the guests on the left,
                  the chart and the log tail on the right. Stacked, the same
                  content forced the dialog to scroll on a laptop; side by
                  side it fits, and each long block is bounded on its own. */}
              <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: 3, alignItems: 'start' }}>
                <Box sx={{ minWidth: 0 }}>
                {/* Six short label/value pairs. One per row spent all the height
                    the wider dialog just gained, so they pair up from sm. */}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 3 }}>
                  <DetailRow icon='ri-time-line' label={t('siteRecovery.protection.schedule')} value={planningLabel(selected)} />
                  <DetailRow icon='ri-timer-line' label={t('siteRecovery.protection.rpoTarget')} value={formatDuration(selected.rpo_target)} />
                  <DetailRow icon='ri-timer-flash-line' label={t('siteRecovery.protection.rpoActual')} value={formatDuration(computeRpoActual(selected.last_sync))} />
                  <DetailRow icon='ri-speed-line' label={t('siteRecovery.protection.throughput')} value={selected.throughput_bps > 0 ? `${formatBytes(selected.throughput_bps)}/s` : '—'} />
                  <DetailRow icon='ri-calendar-line' label={t('siteRecovery.protection.lastSync')} value={selected.last_sync ? new Date(selected.last_sync).toLocaleString() : '—'} mono />
                  <DetailRow icon='ri-calendar-schedule-line' label={t('siteRecovery.protection.nextSync')} value={selected.next_sync && selected.status !== 'paused' ? new Date(selected.next_sync).toLocaleString() : '—'} mono />
                </Box>

                {/* Per-VM breakdown, single-guest jobs included */}
                {(selected.vm_ids || []).length > 0 && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant='overline' sx={{ color: 'text.secondary', fontWeight: 600, mb: 1, display: 'block' }}>
                      {t('siteRecovery.protection.perVmTitle')}
                    </Typography>
                    {reseedQueued && <Alert severity='success' sx={{ mb: 1 }}>{t('siteRecovery.protection.reseedQueued')}</Alert>}
                    {vmStatusesLoading && !vmStatuses && <LinearProgress sx={{ mb: 1 }} />}
                    {vmStatuses && vmStatuses.length === 0 ? (
                      <Typography variant='caption' sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
                        {t('siteRecovery.protection.perVmEmpty')}
                      </Typography>
                    ) : vmStatuses && (
                      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        {vmStatuses.slice(vmPage * VM_ROWS_PER_PAGE, vmPage * VM_ROWS_PER_PAGE + VM_ROWS_PER_PAGE).map(row => {
                          // A suspended guest is not failing, but it is not
                          // being protected right now either, so it reads as a
                          // warning rather than a neutral state.
                          const color = row.status === 'synced' ? 'success' : row.status === 'syncing' ? 'primary' : row.status === 'error' ? 'error' : ['suspended', 'skipped', 'reseed_required', 'source_missing'].includes(row.status) ? 'warning' : 'default'
                          return (
                            /* One line per guest, built like every other list row
                               in the app: type glyph carrying a state dot, then
                               the identity, then the run figures pushed right.
                               The tooltip names the state, which the dot alone
                               cannot, and carries the error when there is one so
                               nothing is lost by folding the row up. */
                            <Box key={row.vmid} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.75, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                              <Tooltip title={row.last_error ? `${t(`siteRecovery.status.${row.status}`)} — ${row.last_error}` : t(`siteRecovery.status.${row.status}`)} arrow>
                                <Box
                                  component='span'
                                  role='img'
                                  aria-label={t(`siteRecovery.status.${row.status}`)}
                                  sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0, lineHeight: 0, fontSize: '1.05rem', color: 'text.secondary' }}
                                >
                                  <i className='ri-computer-line' />
                                  <Box
                                    component='span'
                                    sx={{
                                      position: 'absolute', bottom: -1, right: -2, width: 7, height: 7, borderRadius: '50%',
                                      border: '1.5px solid', borderColor: 'background.paper',
                                      bgcolor: color === 'default' ? 'text.disabled' : `${color}.main`,
                                      ...(row.status === 'syncing' ? {
                                        animation: 'srVmPulse 1.4s ease-in-out infinite',
                                        '@keyframes srVmPulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
                                        '@media (prefers-reduced-motion: reduce)': { animation: 'none' }
                                      } : {})
                                    }}
                                  />
                                </Box>
                              </Tooltip>
                              <Typography variant='body2' sx={{ fontWeight: 600, flexShrink: 0 }}>
                                {row.vm_name ? `${row.vmid} · ${row.vm_name}` : `VM ${row.vmid}`}
                              </Typography>
                              <Typography
                                variant='caption'
                                sx={{ ml: 'auto', pl: 1, color: ['error', 'skipped', 'reseed_required', 'source_missing'].includes(row.status) && row.last_error ? (row.status === 'error' ? 'error.main' : 'warning.main') : 'text.secondary', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              >
                                {['error', 'skipped', 'reseed_required', 'source_missing'].includes(row.status) && row.last_error ? row.last_error : (
                                  <>
                                    {row.last_sync ? new Date(row.last_sync).toLocaleString() : '—'}
                                    {row.bytes_sent > 0 && ` · ${formatBytes(row.bytes_sent)}`}
                                    {row.duration_ms > 0 && ` · ${formatDuration(Math.round(row.duration_ms / 1000))}`}
                                  </>
                                )}
                              </Typography>
                              {row.status === 'reseed_required' && (
                                <Button size='small' color='warning' disabled={selected.status === 'syncing' || selected.status === 'failed_over' || reseedQueuedVmids.has(row.vmid)} onClick={() => {
                                  setReseedError('')
                                  setReseedGuest({ jobId: selected.id, vmid: row.vmid, name: row.vm_name ? `${row.vmid} · ${row.vm_name}` : `VM ${row.vmid}` })
                                }} sx={{ flexShrink: 0 }}>
                                  {t('siteRecovery.protection.reseed')}
                                </Button>
                              )}
                              <Box
                                component='span'
                                aria-hidden
                                sx={{
                                  flexShrink: 0, lineHeight: 0, fontSize: '1.05rem',
                                  color: color === 'default' ? 'text.disabled' : `${color}.main`,
                                  ...(row.status === 'syncing' ? {
                                    animation: 'srVmSpin 1.5s linear infinite',
                                    '@keyframes srVmSpin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
                                    '@media (prefers-reduced-motion: reduce)': { animation: 'none' }
                                  } : {})
                                }}
                              >
                                <i className={vmStatusIcon(row.status)} />
                              </Box>
                            </Box>
                          )
                        })}
                      </Box>
                    )}
                    {vmStatuses && vmStatuses.length > VM_ROWS_PER_PAGE && (
                      <TablePagination
                        component='div'
                        count={vmStatuses.length}
                        page={vmPage}
                        rowsPerPage={VM_ROWS_PER_PAGE}
                        rowsPerPageOptions={[VM_ROWS_PER_PAGE]}
                        onPageChange={(_, value) => setVmPage(value)}
                        sx={{ '& .MuiTablePagination-toolbar': { minHeight: 40, pl: 1 } }}
                      />
                    )}
                  </>
                )}

                </Box>

                <Box sx={{ minWidth: 0 }}>
                {/* Bandwidth history (server-sourced) */}
                <Divider sx={{ my: 2, display: { xs: 'block', md: 'none' } }} />
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant='overline' sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    {t('siteRecovery.protection.bandwidthHistory')}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.25 }}>
                    {(['1h', '6h', '24h', '7d'] as const).map(w => (
                      <Button
                        key={w}
                        size='small'
                        variant={thWindow === w ? 'contained' : 'outlined'}
                        onClick={() => setThWindow(w)}
                        sx={{ minWidth: 32, px: 0.75, py: 0.25, fontSize: '0.65rem' }}
                      >
                        {w}
                      </Button>
                    ))}
                  </Box>
                </Box>
                {thLoading && !thSamples ? (
                  <LinearProgress sx={{ mb: 1 }} />
                ) : (thSamples && thSamples.length >= 2) ? (
                  <Box sx={{ width: '100%', height: 140 }}>
                    <ChartContainer>
                      <AreaChart data={thSamples.map(s => ({ ts: new Date(s.timestamp).getTime(), bps: s.bytes_per_sec }))} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                        <defs>
                          <linearGradient id='thGrad' x1='0' y1='0' x2='0' y2='1'>
                            <stop offset='0%' stopColor='currentColor' stopOpacity={0.3} />
                            <stop offset='100%' stopColor='currentColor' stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <YAxis hide domain={[0, 'dataMax']} />
                        <RTooltip
                          wrapperStyle={{ backgroundColor: 'transparent' }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.[0]) return null
                            const p = payload[0].payload as { ts: number; bps: number }
                            return (
                              <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.25, py: 0.75, boxShadow: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                                  <i className='ri-speed-line' style={{ fontSize: 14, opacity: 0.7 }} />
                                  <Typography variant='caption' sx={{ fontWeight: 700, fontSize: '0.7rem' }}>
                                    {t('siteRecovery.protection.throughput')}
                                  </Typography>
                                </Box>
                                <Typography variant='caption' sx={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, display: 'block' }}>
                                  {formatBytes(p.bps)}/s
                                </Typography>
                                <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', fontSize: '0.6rem' }}>
                                  {new Date(p.ts).toLocaleString()}
                                </Typography>
                              </Box>
                            )
                          }}
                        />
                        <Area
                          type='monotone'
                          dataKey='bps'
                          stroke='currentColor'
                          strokeWidth={1.5}
                          fill='url(#thGrad)'
                          dot={false}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ChartContainer>
                  </Box>
                ) : (
                  <Typography variant='caption' sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
                    {t('siteRecovery.protection.bandwidthHistoryEmpty')}
                  </Typography>
                )}

                {/* Logs */}
                <Divider sx={{ my: 2 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant='overline' sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    {t('siteRecovery.protection.recentLogs')}
                  </Typography>
                  {logs && logs.length > 0 && (
                    <Tooltip title={copied ? 'Copied!' : 'Copy logs'} arrow>
                      <IconButton size='small' onClick={copyLogs} sx={{ p: 0.5 }}>
                        <i className={copied ? 'ri-check-line' : 'ri-file-copy-line'} style={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
                {logs && logs.length > 0 ? (
                  <Box sx={{ maxHeight: { xs: 200, md: '34vh' }, overflow: 'auto', bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                    {logs.slice(0, 50).map((log, i) => (
                      <Typography key={i} variant='caption' sx={{
                        display: 'block', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.65rem', lineHeight: 1.7,
                        color: log.level === 'error' ? 'error.main' : log.level === 'warning' ? 'warning.main' : 'text.secondary'
                      }}>
                        [{new Date(log.created_at).toLocaleTimeString()}] {log.message}
                      </Typography>
                    ))}
                  </Box>
                ) : (
                  <Typography variant='caption' sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
                    No logs available
                  </Typography>
                )}

                </Box>
              </Box>
            </Box>
          </>
        )}
      </Dialog>

      <Dialog open={!!reseedGuest} onClose={() => { if (!reseedBusy) setReseedGuest(null) }} maxWidth='sm' fullWidth>
        <DialogTitle>{t('siteRecovery.protection.reseedTitle', { guest: reseedGuest?.name || '' })}</DialogTitle>
        <DialogContent>
          <Alert severity='warning'>{t('siteRecovery.protection.reseedWarning')}</Alert>
          {reseedError && <Alert severity='error' sx={{ mt: 2 }}>{reseedError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button disabled={reseedBusy} onClick={() => setReseedGuest(null)}>{t('common.cancel')}</Button>
          <Button variant='contained' color='warning' disabled={reseedBusy} onClick={confirmReseed}>{t('siteRecovery.protection.reseed')}</Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!confirmDeleteJob} onClose={() => setConfirmDeleteJob(null)} maxWidth='sm' fullWidth>
        <DialogTitle>{t('siteRecovery.protection.deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ py: 2 }}>
            <Alert severity='warning' sx={{ py: 1.5 }}>
              {t('siteRecovery.protection.deleteConfirmDesc')}
            </Alert>
            <Alert severity='info' sx={{ py: 1.5 }} icon={<i className='ri-information-line' />}>
              {t('siteRecovery.protection.deleteOrphansNote')}
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmDeleteJob(null)}>{t('common.cancel')}</Button>
          <Button
            variant='contained' color='error'
            startIcon={<i className='ri-delete-bin-line' />}
            onClick={() => {
              if (confirmDeleteJob) {
                onDeleteJob(confirmDeleteJob.id)
                setConfirmDeleteJob(null)
                closeDrawer()
              }
            }}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
