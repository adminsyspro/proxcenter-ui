'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Button, Chip, CircularProgress, Drawer, IconButton, Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import { rowCluster } from '@/lib/microseg/pendingChanges'
import type { MicrosegRevision, MicrosegRun } from '@/lib/microseg/types'
import { clustersToRead, shownAnswers, useMergedClusters } from '@/lib/microseg/useMerged'
import { REVISIONS_LIMIT, useMicrosegRevisions, useMicrosegRuns } from '@/lib/microseg/useMicrosegLists'

import ClusterChip from './ClusterChip'
import ClusterRunRow, { clusterRunStatus, shownClusterName } from './ClusterRunRow'
import ClusterUnreadLines from './ClusterUnreadLines'
import { isVersionConflict, useDialogAction } from './dialogParts'
import { ENGINE_KINDS, historyRows, type HistoryKind, type HistoryRow } from './historyModel'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import PolicyPager, { usePaged } from './PolicyPager'
import RunDetail from './RunDetail'
import { runHasDetails, runSummaryParts } from './runDetailModel'
import { startedRuns } from './runsInProgress'
import { RowsPerPageSelect, useRowsPerPage } from './useRowsPerPage'
import { formatWhen } from './summaryModel'
import TruncatedText from './TruncatedText'

/** The runs the table reads at once (the newest), merged with the revisions and paged with them. */
export const RUNS_READ = 100
/** The rows per page of the table, remembered per browser. */
export const HISTORY_ROWS_KEY = 'proxcenter.microseg.historyRows'

const KNOWN_RUN_KINDS = new Set(['light', 'ips', 'full', 'log', 'targeted', 'plan', 'apply', 'remove', 'restore'])
const STATUS_COLOR: Record<string, 'success' | 'error' | 'info'> = { done: 'success', failed: 'error', running: 'info' }
const KINDS: readonly HistoryKind[] = ['all', 'revisions', 'runs']
const COLUMNS = 7

/** The last runs of one cluster (a per-cluster read of the merged list). */
const useRecentRuns = (connId: string | null) => useMicrosegRuns(connId, { limit: RUNS_READ })

/** On a shared policy: the name of the cluster of each row (its chip), "Another cluster" for one the user cannot see. */
type ClusterOf = ((run: MicrosegRun) => { id: string; name: string }) | null

type RowProps = { row: HistoryRow; latestId: string | undefined; onRestore: (r: MicrosegRevision) => void; onDetails: (r: MicrosegRun) => void; clusterOf: ClusterOf }

/** The duration of a run, as the table says it. */
function useDuration() {
  const format = useFormatter()
  return (run: MicrosegRun) => format.number(run.duration_ms / 1000, { style: 'unit', unit: 'second', unitDisplay: 'narrow', maximumFractionDigits: 1 })
}

/** Under a revision of a shared policy: the application run of each cluster, one line each, its details on demand. */
function RevisionRuns({ runs, clusterOf, onDetails }: { runs: MicrosegRun[]; clusterOf: NonNullable<ClusterOf>; onDetails: (r: MicrosegRun) => void }) {
  const t = useTranslations('microsegPilot.history')
  const tb = useTranslations('microsegPilot.banner.runStatus')
  const duration = useDuration()
  return (
    <TableRow data-row='revision-runs'>
      <TableCell colSpan={COLUMNS} sx={{ py: 0.5, pl: 4 }}>
        <Box role='list' aria-label={t('table.clusterRuns')}>
          {runs.map(run => {
            const cluster = clusterOf(run)
            return (
              <ClusterRunRow
                key={run.id}
                connectionId={cluster.id}
                name={cluster.name}
                status={clusterRunStatus(run)}
                text={`${tb(run.status)} · ${duration(run)}`}
                tip={run.error || undefined}
                extra={runHasDetails(run) ? (
                  <Tooltip title={t('table.details')}>
                    <IconButton size='small' aria-label={t('table.details')} onClick={() => onDetails(run)}><i className='ri-file-list-3-line' /></IconButton>
                  </Tooltip>
                ) : undefined}
              />
            )
          })}
        </Box>
      </TableCell>
    </TableRow>
  )
}

/** A revision on one row: when, "Revision applied v9", who, its counts and diff, Applied (Latest), Restore. */
function RevisionLine({ row, latestId, onRestore, onDetails, clusterOf }: RowProps & { row: Extract<HistoryRow, { type: 'revision' }> }) {
  const t = useTranslations('microsegPilot.history')
  const [open, setOpen] = useState(false)
  const clusterRuns = clusterOf && row.runs && row.runs.length > 0 ? row.runs : null
  const toggle = t(open ? 'table.hideClusterRuns' : 'table.showClusterRuns')
  const format = useFormatter()
  const { canWrite } = useMicrosegWrite()
  const { revision, zones, flows, exceptions, diff } = row
  const version = t('revisions.version', { version: revision.version })
  let counts = zones === null || flows === null ? '-' : t('revisions.counts', { zones, flows })
  // Told only when the revision holds some: most have none, and an older one never had the list.
  if (exceptions > 0) counts = t('revisions.countsWithExceptions', { counts, exceptions })
  const summary = diff ? `${counts} · ${t('table.diff', { added: diff.added, removed: diff.removed, changed: diff.changed })}` : counts
  const author = revision.author?.trim()
  return (
    <>
    <TableRow aria-label={version} data-row='revision'>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatWhen(format, revision.created_at)}</TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className='ri-history-line' aria-hidden />
          <Typography variant='body2' fontWeight={600}>{t('table.revision', { version: revision.version })}</Typography>
        </Box>
      </TableCell>
      <TableCell><Typography variant='body2' color={author ? 'text.primary' : 'text.disabled'}>{author || '-'}</Typography></TableCell>
      <TableCell sx={{ maxWidth: 320 }}>
        <TruncatedText text={summary} title={t('revisions.detail.zones', { names: (revision.snapshot?.zones ?? []).map(z => z.name).join(', ') || t('revisions.detail.none') })} variant='body2' data-testid='history-summary' />
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        <Chip size='small' variant='outlined' color='success' label={t('table.applied')} sx={{ mr: 0.5 }} />
        {revision.id === latestId && <Chip size='small' color='primary' variant='outlined' label={t('revisions.latest')} />}
      </TableCell>
      <TableCell>-</TableCell>
      <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
        <WriteTip>
          <Button size='small' variant='outlined' onClick={() => onRestore(revision)} disabled={!canWrite} sx={{ whiteSpace: 'nowrap' }}>{t('revisions.restore')}</Button>
        </WriteTip>
        {clusterRuns && (
          <Tooltip title={toggle}>
            <IconButton size='small' aria-label={toggle} aria-expanded={open} onClick={() => setOpen(v => !v)} sx={{ ml: 0.5 }}>
              <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
            </IconButton>
          </Tooltip>
        )}
      </TableCell>
    </TableRow>
    {clusterRuns && open && <RevisionRuns runs={clusterRuns} clusterOf={clusterOf!} onDetails={onDetails} />}
    </>
  )
}

/** A run on one row: when, "Run: Apply", the engine or an administrator, what an engine run read then its writes and calls (its error), its status, its duration, Details when the row does not say it all. */
function RunLine({ row, onDetails, clusterOf }: Pick<RowProps, 'onDetails' | 'clusterOf'> & { row: Extract<HistoryRow, { type: 'run' }> }) {
  const t = useTranslations('microsegPilot.history')
  const tb = useTranslations('microsegPilot.banner.runStatus')
  const format = useFormatter()
  const { run } = row
  const kind = KNOWN_RUN_KINDS.has(run.kind) ? t(`runs.kind.${run.kind}`) : run.kind
  const started = formatWhen(format, run.started_at)
  const duration = useDuration()(run)
  const cluster = clusterOf?.(run)
  const trigger = run.result?.trigger
  const figures = runSummaryParts(run).map(p => ('count' in p ? t(`runs.summary.${p.key}`, { count: p.count, total: p.total ?? 0 }) : t(`runs.summary.${p.key}`, { nodes: p.text })))
  // An engine run says what it read; its writes only when it wrote (most loops read only).
  const writes = figures.length > 0 && run.writes === 0 ? [] : [t('runs.writes', { count: run.writes })]
  const summary = [...figures, ...writes, t('runs.calls', { count: run.api_calls })].join(' · ')
  const byAdmin = !ENGINE_KINDS.has(run.kind) || trigger === 'check'
  // A pass another cluster of the policy asked for (its addresses changed): said as such, not as a scheduled one.
  let actor = byAdmin ? t('table.admin') : t('table.engine')
  let actorTip = trigger === 'check' ? t('table.actorCheck') : t('table.actorInferred')
  if (trigger === 'peer') {
    actor = t('table.peer')
    actorTip = t('table.actorPeer')
  }
  return (
    <TableRow aria-label={t('runs.rowLabel', { kind, time: started })} data-row='run'>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{started}</TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className='ri-play-circle-line' aria-hidden />
          {cluster && <ClusterChip connectionId={cluster.id} name={cluster.name} compact />}
          <Typography variant='body2'>{t('table.run', { kind })}</Typography>
        </Box>
      </TableCell>
      <TableCell>
        <Tooltip title={actorTip}>
          <Typography variant='body2' color='text.secondary' sx={{ display: 'inline' }}>{actor}</Typography>
        </Tooltip>
      </TableCell>
      <TableCell sx={{ maxWidth: 420 }}>
        <TruncatedText text={summary} variant='body2' component='div' data-testid='history-summary' />
        {run.error && (
          <TruncatedText text={run.error} variant='caption' color='error' component='div' />
        )}
      </TableCell>
      <TableCell><Chip size='small' variant='outlined' color={STATUS_COLOR[run.status] ?? 'default'} label={tb(run.status)} /></TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{duration}</TableCell>
      <TableCell align='right'>
        {runHasDetails(run) && (
          <Tooltip title={t('table.details')}>
            <IconButton size='small' aria-label={t('table.details')} onClick={() => onDetails(run)}><i className='ri-file-list-3-line' /></IconButton>
          </Tooltip>
        )}
      </TableCell>
    </TableRow>
  )
}

/**
 * The History sub-tab as one table, the newest first: the revisions of the policy (restorable, with what each changed
 * against the one before) and the runs of the engine (their result in a drawer, read when it opens), filtered on All,
 * Revisions or Runs, as many rows per page as the sub-tab's height holds (or 10, 25, 50), the table scrolling inside
 * and its pager pinned at the bottom. The last 100 revisions and the last 100 runs are read.
 */
export default function HistoryPanel({ connectionId, policy, reloadPolicy, startRun, anchor, clusterIds, clusterName }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.history')
  const tc = useTranslations('microsegPilot.plan.cluster')
  const api = useMemo(() => microsegApi(connectionId), [connectionId])
  // The revisions are the policy's (one read); the runs are those of each cluster, read through each one and merged.
  const revisions = useMicrosegRevisions(connectionId)
  const ids = useMemo(() => clustersToRead(connectionId, { anchor, clusterIds }), [connectionId, anchor, clusterIds])
  const shared = ids.length > 1
  const runReads = useMergedClusters(ids, useRecentRuns)
  const runs = useMemo(() => {
    const answers = shownAnswers(runReads, shared)
    const list = ids.flatMap(id => (answers[id] ?? []).map(run => ({ ...run, connection_id: rowCluster(run, id) })))
    const answered = ids.some(id => answers[id] !== undefined)
    const error = shared ? undefined : runReads.errors[connectionId]
    return { data: answered ? list : undefined, error, reload: runReads.reload, capped: ids.some(id => (answers[id]?.length ?? 0) >= RUNS_READ) }
  }, [runReads, shared, ids, connectionId])
  const clusterOf = useMemo<ClusterOf>(() => (shared
    ? (run: MicrosegRun) => ({ id: run.connection_id, name: shownClusterName(run.connection_id, connectionId, clusterName, tc('other')) })
    : null), [shared, connectionId, clusterName, tc])
  const [kind, setKind] = useState<HistoryKind>('all')
  const [details, setDetails] = useState<MicrosegRun | null>(null)
  const [restoring, setRestoring] = useState<MicrosegRevision | null>(null)
  const restore = useDialogAction()
  const latestId = policy.last_revision?.id
  const rows = useMemo(() => historyRows(revisions.data ?? [], runs.data ?? [], kind, { grouped: shared }), [revisions.data, runs.data, kind, shared])
  // As many rows as the height holds (Auto), or the size chosen; the table body scrolls inside the sub-tab.
  const { ref: scrollRef, size: pageSize, choice: rowsChoice, setChoice: setRowsChoice } = useRowsPerPage(HISTORY_ROWS_KEY)
  const paged = usePaged(rows, pageSize)

  // The draft is re-read when a run ends (the tab does it); a new head there means a revision was recorded.
  const seenLatest = useRef(latestId)
  const reloadRevisions = revisions.reload
  useEffect(() => {
    if (seenLatest.current === latestId) return
    seenLatest.current = latestId
    void reloadRevisions()
  }, [latestId, reloadRevisions])

  const confirm = async () => {
    if (!restoring) return
    const target = restoring
    const ok = await restore.run(async () => {
      try {
        // The current draft version: a restore replaces the draft, so it is refused if the draft moved.
        const started = await api.restoreRevision(target.id, policy.version)
        startRun({
          ...startedRuns(started, connectionId),
          kind: 'restore',
          label: t('revisions.restoreLabel', { version: target.version }),
          runningText: t('revisions.restoreRunning', { version: target.version }),
        })
      } catch (e) {
        if (isVersionConflict(e)) await reloadPolicy().catch(() => undefined)
        throw e
      }
    })
    if (ok) setRestoring(null)
  }

  const failed = (!!revisions.error && !revisions.data) || (!!runs.error && !runs.data)
  // On a shared policy the runs are loading until one cluster answered or every one failed.
  const runsDone = !!runs.data || !!runs.error || (ids.length > 0 && Object.keys(runReads.errors).length === ids.length)
  const loading = (!revisions.data && !revisions.error) || !runsDone
  const empty = !loading && rows.length === 0
  const emptyText: Record<HistoryKind, string> = { all: t('table.empty'), revisions: t('revisions.empty'), runs: t('runs.empty') }

  return (
    <Box sx={{ px: 3, pb: 3, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 40, mb: 1, flexWrap: 'wrap' }}>
        <Typography variant='subtitle1' fontWeight={600} sx={{ flex: 1 }}>{t('table.title')}</Typography>
        <ToggleButtonGroup
          size='small'
          exclusive
          value={kind}
          onChange={(_, next: HistoryKind | null) => { if (next) setKind(next) }}
          aria-label={t('table.kindLabel')}
          sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1.25, textTransform: 'none', color: 'text.secondary' }, '& .MuiToggleButton-root.Mui-selected': { bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: 'primary.dark' } } }}
        >
          {KINDS.map(k => <ToggleButton key={k} value={k} data-testid={`history-kind-${k}`}>{t(`table.kind.${k}`)}</ToggleButton>)}
        </ToggleButtonGroup>
      </Box>
      {revisions.error && !revisions.data && <MicrosegErrorAlert error={revisions.error} onRetry={revisions.reload} />}
      {!!runs.error && !runs.data && <MicrosegErrorAlert error={runs.error} onRetry={runs.reload} />}
      {shared && <ClusterUnreadLines errors={runReads.errors} tabConnection={connectionId} clusterName={clusterName} />}
      {loading && !failed && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
          <CircularProgress size={18} />
          <Typography color='text.secondary'>{t('table.loading')}</Typography>
        </Box>
      )}
      {empty && <Typography color='text.secondary' sx={{ py: 2 }}>{emptyText[kind]}</Typography>}
      {rows.length > 0 && (
        <>
          <Box ref={scrollRef} data-testid='history-scroll' sx={{ flex: '1 1 0', minHeight: 240, overflow: 'auto' }}>
            <Table size='small' stickyHeader aria-label={t('table.title')} sx={{ '& td, & th': { px: 1 } }}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('table.colDate')}</TableCell>
                  <TableCell>{t('table.colType')}</TableCell>
                  <TableCell>{t('table.colActor')}</TableCell>
                  <TableCell>{t('table.colSummary')}</TableCell>
                  <TableCell>{t('table.colResult')}</TableCell>
                  <TableCell>{t('table.colDuration')}</TableCell>
                  <TableCell align='right'>{t('table.colActions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paged.rows.map(row => (row.type === 'revision'
                  ? <RevisionLine key={`rev:${row.id}`} row={row} latestId={latestId} onRestore={r => { restore.reset(); setRestoring(r) }} onDetails={setDetails} clusterOf={clusterOf} />
                  : <RunLine key={`run:${row.id}`} row={row} onDetails={setDetails} clusterOf={clusterOf} />))}
              </TableBody>
            </Table>
          </Box>
          {/* Pinned under the table: the caps, the rows per page and the pager. */}
          <Box data-testid='history-footer' sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, pt: 1, borderTop: 1, borderColor: 'divider', minHeight: 48 }}>
            <Typography variant='caption' color='text.secondary' sx={{ flex: 1, minWidth: 0 }} noWrap>
              {((revisions.data?.length ?? 0) >= REVISIONS_LIMIT || runs.capped) ? t('table.capped', { count: RUNS_READ }) : ''}
            </Typography>
            <RowsPerPageSelect choice={rowsChoice} onChoice={setRowsChoice} />
            <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
          </Box>
        </>
      )}

      <Drawer anchor='right' open={details !== null} onClose={() => setDetails(null)} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 }, p: 2.5 } } }}>
        {details && (
          <Box role='region' aria-label={t('table.detailsOf', { kind: KNOWN_RUN_KINDS.has(details.kind) ? t(`runs.kind.${details.kind}`) : details.kind })}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Typography variant='subtitle1' fontWeight={600} sx={{ flex: 1 }}>
                {t('table.detailsOf', { kind: KNOWN_RUN_KINDS.has(details.kind) ? t(`runs.kind.${details.kind}`) : details.kind })}
              </Typography>
              <IconButton size='small' aria-label={t('table.closeDetails')} onClick={() => setDetails(null)}><i className='ri-close-line' /></IconButton>
            </Box>
            {/* A run is read through its own cluster (the rights of that cluster). */}
            <RunDetail connectionId={rowCluster(details, connectionId)} runId={details.id} />
          </Box>
        )}
      </Drawer>

      <MicrosegConfirmDialog
        open={restoring !== null}
        title={t('revisions.restoreTitle', { version: restoring?.version ?? 0 })}
        body={t('revisions.restoreBody')}
        confirmLabel={t('revisions.restore')}
        color='warning'
        busy={restore.busy}
        error={restore.error}
        onConfirm={() => void confirm()}
        onCancel={() => setRestoring(null)}
      />
    </Box>
  )
}
