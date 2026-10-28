'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Tooltip,
  Typography
} from '@mui/material'
import { useTheme } from '@mui/material/styles'

import { extractLogs, jobActions, jobDetailUrl, normalizeLog, syntheticLogs } from '@/lib/tasks/jobActions'
import { HOST_DRAIN_JOB_TYPE, hostDrainJobRows } from '@/lib/tasks/hostDrainRows'
import { useCopyToClipboard } from '@/lib/clipboard'
import LiveLogBox from '@/components/ui/LiveLogBox'
import { GuestGlyph, NodeGlyph } from '@/components/automation/drs/glyphs'
import WarmCutoverButton, { canRequestCutover } from '@/app/(dashboard)/infrastructure/inventory/components/WarmCutoverButton'

import { StatusChip, TypeChip } from './JobChips'

// RemixIcon replacements for @mui/icons-material
// A state icon takes the palette colour it is given (success, error...), as
// the MUI icon it replaces did; without it every state rendered black.
const StateIcon = ({ icon, color, fontSize }) => (
  <Box component="i" className={icon} sx={{ fontSize: fontSize === 'small' ? 18 : 20, color: color === 'disabled' ? 'text.disabled' : color && `${color}.main` }} />
)
const CheckCircleIcon = (props) => <StateIcon icon="ri-checkbox-circle-fill" {...props} />
const ErrorIcon = (props) => <StateIcon icon="ri-error-warning-fill" {...props} />
const WarningIcon = (props) => <StateIcon icon="ri-alert-line" {...props} />
const InfoIcon = (props) => <StateIcon icon="ri-information-line" {...props} />
const CloseIcon = (props) => <i className="ri-close-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PauseIcon = (props) => <i className="ri-pause-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PlayArrowIcon = (props) => <i className="ri-play-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StopIcon = (props) => <i className="ri-stop-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

/*
   Detail of one Task Center job: progress, logs and the actions its type
   actually supports. Lives here rather than in the Task Center page because
   the ProxCenter tab of the taskbar opens the very same dialog on a
   double-click.
*/

function getNodeStatusIcon(status) {
  switch (status) {
    case 'completed':
      return <CheckCircleIcon color="success" fontSize="small" />
    case 'failed':
      return <ErrorIcon color="error" fontSize="small" />
    case 'running':
    case 'updating':
    case 'migrating_vms':
    case 'rebooting':
    case 'entering_maintenance':
    case 'exiting_maintenance':
    case 'verifying_health':
    case 'waiting_return':
      return <CircularProgress size={18} />
    case 'pending':
      return <InfoIcon color="disabled" fontSize="small" />
    case 'skipped':
      return <WarningIcon color="warning" fontSize="small" />
    default:
      return <InfoIcon color="disabled" fontSize="small" />
  }
}

function drainGuestStateIcon(status) {
  if (status === 'completed') return <CheckCircleIcon color="success" fontSize="small" />
  if (status === 'failed' || status === 'skipped') return <ErrorIcon color="error" fontSize="small" />
  if (status === 'migrating') return <CircularProgress size={16} />
  return <InfoIcon color="disabled" fontSize="small" />
}

// The follow rule moved to the shared hook (#1201); re-exported for its tests.
export { isAtTail } from '@/hooks/useFollowTail'

/**
 * The log as text, formatted the way the panel prints it.
 *
 * Copies EVERY entry, not just the 100 the panel renders: the button exists to
 * paste a whole run into an issue or a mail, and a truncated log is worse than
 * none.
 */
export function logsAsText(entries) {
  return entries
    .map(normalizeLog)
    .map(log => {
      const ts = log.timestamp ? `[${new Date(log.timestamp).toLocaleTimeString()}] ` : ''
      const node = log.node ? `[${log.node}] ` : ''

      return `${ts}${node}${log.message}`
    })
    .join('\n')
}

/* --------------------------------
   Job Detail Dialog
-------------------------------- */

export default function JobDetailDialog({ open, onClose, job: openedJob, onAction, actionError, isEnterprise, t }) {
  // Keyed by job id: the dialog is never unmounted, so a plain array kept
  // showing the previous job's logs under the next job opened.
  const [logState, setLogState] = useState({ jobId: null, entries: [], error: null, detail: null })
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const forThisJob = logState.jobId && logState.jobId === openedJob?.id
  // A host drain (#248) is read again with its log: its guests and progress
  // follow that record while the dialog stays open, not the row it was opened
  // from, which never changes.
  const job = useMemo(() => {
    const record = openedJob?.type === HOST_DRAIN_JOB_TYPE && forThisJob ? logState.detail : null
    if (!record) return openedJob
    return hostDrainJobRows([record], () => openedJob.target).find(r => r.id === openedJob.id) ?? openedJob
  }, [openedJob, forThisJob, logState.detail])
  // Host drains are Community, like the drain itself: their record is read
  // whatever the edition.
  const canFetch = isEnterprise || openedJob?.type === HOST_DRAIN_JOB_TYPE
  const fetched = forThisJob ? logState.entries : []
  // Site Recovery has nothing to fetch: its record is the per-VM results the
  // row already carries.
  const logs = fetched.length > 0 ? fetched : syntheticLogs(job)
  // A refused read (a role with tasks.view but not automation.view on the
  // orchestrator routes) must say so rather than look like an empty log.
  const logError = forThisJob ? logState.error : null
  const [loading, setLoading] = useState(false)
  const logCopy = useCopyToClipboard()
  // Held per job id rather than as a boolean: a stale confirmation must never
  // carry over to the next job opened in this (permanently mounted) dialog.
  const [confirmCancelFor, setConfirmCancelFor] = useState(null)
  const confirmCancel = open && !!job?.id && confirmCancelFor === job.id

  const detailUrl = jobDetailUrl(job)

  // Fetch full job details when dialog opens
  useEffect(() => {
    if (open && detailUrl && canFetch) {
      fetchJobDetails()
    }
  }, [open, detailUrl, canFetch])

  const fetchJobDetails = async ({ silent = false } = {}) => {
    if (!detailUrl || !canFetch) return

    // A background refresh must not raise the spinner: on a running job it
    // fires every 3 s and the header blinked continuously.
    if (!silent) setLoading(true)
    try {
      const res = await fetch(detailUrl)
      if (res.ok) {
        const data = await res.json()
        setLogState({ jobId: job.id, entries: extractLogs(data), error: null, detail: data?.data ?? null })
      } else {
        setLogState({ jobId: job.id, entries: [], error: `HTTP ${res.status}`, detail: null })
      }
    } catch (e) {
      console.error('Error fetching job details:', e)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // Auto-refresh if job is running
  useEffect(() => {
    if (open && detailUrl && job?.status === 'running' && canFetch) {
      const interval = setInterval(() => fetchJobDetails({ silent: true }), 3000)
      return () => clearInterval(interval)
    }
  }, [open, detailUrl, job?.status, canFetch])

  if (!job) return null

  const nodeStatuses = job.metadata?.nodeStatuses || []
  // Host drain (#248): one entry per guest, with where it went or why it stayed.
  const drainGuests = job.type === 'host_drain' && Array.isArray(job.metadata?.guests) ? job.metadata.guests : []
  const actions = jobActions(job)

  // A warm migration holding for its operator. The row this dialog was opened
  // with only says "running"; the detail fetched above has the real step, the
  // cutover mode and the downtime estimate. Without this the switchover was
  // only reachable from the migrate dialog that started the run, gone as soon
  // as it was closed or the page reloaded.
  const migDetail = job.type === 'migration' && forThisJob ? logState.detail : null
  const cutoverJob = migDetail
    ? { id: job.id, status: migDetail.status, projectedDowntimeSec: migDetail.projectedDowntimeSec, config: { cutoverMode: migDetail.cutoverMode, convertGuest: migDetail.convertGuest } }
    : null
  const showCutover = canRequestCutover(cutoverJob)
  const isRollingUpdate = job.type === 'rolling_update'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { maxHeight: '80vh' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <TypeChip type={job.type} t={t} />
          <Typography variant="h6">{job.name}</Typography>
          <StatusChip status={job.status} t={t} />
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={3}>
          {/* Progress */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              {/* The node counter only means something for a rolling update;
                  every other type shows its own one-line summary instead of a
                  hardcoded "0 / 0 nodes". */}
              <Typography variant="body2">
                {isRollingUpdate
                  ? t('jobsPage.progression', { completed: job.metadata?.completedNodes || 0, total: job.metadata?.totalNodes || 0 })
                  : job.detail || '—'}
              </Typography>
              {isRollingUpdate && job.metadata?.currentNode ? (
                <Typography variant="body2" color="text.secondary">
                  {t('jobsPage.currentlyRunning', { node: job.metadata.currentNode })}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">{`${job.progress || 0}%`}</Typography>
              )}
            </Box>
            <LinearProgress
              variant="determinate"
              value={job.progress || 0}
              sx={{ height: 8, borderRadius: 1 }}
            />
          </Box>

          {/* Info */}
          <Box sx={{ display: 'flex', gap: 4 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('jobsPage.target')}</Typography>
              <Typography variant="body2">{job.target || '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">{t('jobsPage.started')}</Typography>
              <Typography variant="body2">
                {job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}
              </Typography>
            </Box>
            {job.endedAt && (
              <Box>
                <Typography variant="caption" color="text.secondary">{t('jobsPage.ended')}</Typography>
                <Typography variant="body2">
                  {new Date(job.endedAt).toLocaleString()}
                </Typography>
              </Box>
            )}
          </Box>

          {/* Actions */}
          {(actions.length > 0 || showCutover) && !confirmCancel && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              {showCutover && (
                <WarmCutoverButton job={cutoverJob} onRequested={() => fetchJobDetails({ silent: true })} />
              )}
              {actions.includes('pause') && (
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  startIcon={<PauseIcon />}
                  onClick={() => onAction(job, 'pause')}
                >
                  {t('jobsPage.pause')}
                </Button>
              )}
              {actions.includes('resume') && (
                <Button
                  size="small"
                  variant="outlined"
                  color="primary"
                  startIcon={<PlayArrowIcon />}
                  onClick={() => onAction(job, 'resume')}
                >
                  {t('jobsPage.resume')}
                </Button>
              )}
              {actions.includes('approve') && (
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={<PlayArrowIcon />}
                  onClick={() => onAction(job, 'approve')}
                >
                  {t('updates.approveNode', { node: job.metadata?.pendingApproval })}
                </Button>
              )}
              {actions.includes('cancel') && (
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<StopIcon />}
                  onClick={() => (job.type === 'migration' ? setConfirmCancelFor(job.id) : onAction(job, 'cancel'))}
                >
                  {job.type === 'migration' ? t('inventoryPage.esxiMigration.cancelMigration') : t('common.cancel')}
                </Button>
              )}
            </Box>
          )}

          {/* Cancelling a migration is not a UI-only action: it stops the
              pipeline and leaves whatever was already copied on the target
              storage, so it gets the same warning as the inventory panel. */}
          {confirmCancel && (
            <Card variant="outlined" sx={{ borderColor: 'error.main' }}>
              <CardContent>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                  {t('inventoryPage.esxiMigration.cancelMigrationConfirmTitle')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('inventoryPage.esxiMigration.cancelMigrationConfirmStop')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('inventoryPage.esxiMigration.cancelMigrationConfirmVolumesKept')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('inventoryPage.esxiMigration.cancelMigrationConfirmSourceUntouched')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                  <Button
                    size="small"
                    variant="contained"
                    color="error"
                    startIcon={<StopIcon />}
                    onClick={() => {
                      setConfirmCancelFor(null)
                      onAction(job, 'cancel')
                    }}
                  >
                    {t('inventoryPage.esxiMigration.cancelMigration')}
                  </Button>
                  <Button size="small" variant="outlined" onClick={() => setConfirmCancelFor(null)}>
                    {t('common.close')}
                  </Button>
                </Box>
              </CardContent>
            </Card>
          )}

          {/* Error */}
          {(actionError || job.metadata?.error) && (
            <Box sx={{ p: 2, bgcolor: 'error.main', color: 'error.contrastText', borderRadius: 1 }}>
              <Typography variant="body2">{actionError || job.metadata.error}</Typography>
            </Box>
          )}

          {/* Host drain guests */}
          {drainGuests.length > 0 && (
            <Card variant="outlined">
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    {t('jobsPage.drainGuests')}
                  </Typography>
                  {job.metadata?.maintenanceEnabled && (
                    <Chip size="small" color="warning" variant="outlined" label={t('jobsPage.drainMaintenanceEnabled')} />
                  )}
                  {Array.isArray(job.metadata?.remaining) && job.metadata.remaining.length > 0 && job.status !== 'running' && (
                    <Chip size="small" color="error" label={job.metadata.node
                      ? t('jobsPage.drainRemaining', { count: job.metadata.remaining.length, node: job.metadata.node })
                      : t('jobsPage.drainRemainingSelection', { count: job.metadata.remaining.length })} />
                  )}
                </Box>
                <List dense disablePadding>
                  {drainGuests.map((g) => {
                    const left = g.status === 'completed'
                    // A selection (#1218) has no node: each guest names its own.
                    const from = g.source_node || job.metadata.node
                    const why = g.failure_reason || g.error || (g.status === 'skipped' ? g.reason : '')
                    const state = drainGuestStateIcon(g.status)
                    // One line per guest, as in the plan: why it stayed rides on its state icon.
                    return (
                      <ListItem key={g.vmid} divider sx={{ py: 0.5, gap: 1 }} data-testid={`drain-guest-${g.vmid}`}>
                        <Box sx={{ width: 20, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                          {why ? <Tooltip title={why} placement="right"><Box component="span" sx={{ display: 'flex', cursor: 'help' }} aria-label={why}>{state}</Box></Tooltip> : state}
                        </Box>
                        <GuestGlyph type={g.type} status={g.running ? 'running' : 'stopped'} dotBorder={dotBorder} />
                        <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>{g.vmid} {g.name}</Typography>
                        {g.ha && <Chip size="small" label="HA" sx={{ height: 16, fontSize: '0.6rem', flexShrink: 0 }} />}
                        {g.mode && g.mode !== 'ha' && <Chip size="small" variant="outlined" label={g.mode} sx={{ height: 16, fontSize: '0.6rem', flexShrink: 0 }} />}
                        <Box sx={{ flex: 1 }} />
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, color: 'text.secondary' }} data-testid={`drain-guest-route-${g.vmid}`}>
                          <NodeGlyph status="online" dark={isDark} dotBorder={dotBorder} />
                          <Typography variant="caption">{from}</Typography>
                          {(left || g.target_node) && (
                            <>
                              <Typography variant="caption">→</Typography>
                              {g.target_node && <NodeGlyph status="online" dark={isDark} dotBorder={dotBorder} />}
                              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.primary' }}>{g.target_node || (g.mode === 'ha' ? 'HA' : '?')}</Typography>
                            </>
                          )}
                        </Box>
                      </ListItem>
                    )
                  })}
                </List>
              </CardContent>
            </Card>
          )}

          {/* Node statuses */}
          {nodeStatuses.length > 0 && (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                  {t('jobsPage.nodeStatuses')}
                </Typography>
                <List dense>
                  {nodeStatuses.map((ns) => (
                    <ListItem key={ns.node_name}>
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        {getNodeStatusIcon(ns.status)}
                      </ListItemIcon>
                      <ListItemText
                        primary={ns.node_name}
                        secondary={
                          <>
                            {ns.status}
                            {ns.version_before && ns.version_after &&
                              ` • ${ns.version_before} → ${ns.version_after}`}
                            {ns.did_reboot && ` • ${t('jobsPage.rebooted')}`}
                          </>
                        }
                      />
                      {ns.error && (
                        <Chip size="small" label={t('common.error')} color="error" />
                      )}
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>
          )}

          {/* Logs */}
          <Card variant="outlined">
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  {t('jobsPage.logs')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {loading && <CircularProgress size={16} />}
                  {logs.length > 0 && (
                    <Tooltip title={logCopy.copied ? t('common.copied') : t('common.copy')}>
                      <IconButton
                        size="small"
                        aria-label={t('common.copy')}
                        onClick={() => { void logCopy.copy(logsAsText(logs)) }}
                        sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                      >
                        <i className={logCopy.copied ? 'ri-check-line' : 'ri-file-copy-line'} style={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </Box>
              {/* Follows the job like a terminal, paused while the reader scrolls up.
                  Reopening the dialog, or opening it on another job, starts at
                  the tail again: the dialog itself is never unmounted. */}
              <LiveLogBox
                lineCount={logs.length}
                resetKey={`${open}:${job.id}`}
                jumpButton={false}
                sx={{
                  maxHeight: 300,
                  overflow: 'auto',
                  bgcolor: 'background.default',
                  borderRadius: 1,
                  p: 1,
                  fontFamily: 'monospace',
                  fontSize: 11,
                }}
              >
                {logs.length === 0 ? (
                  <Typography variant="body2" color={logError ? 'error.main' : 'text.secondary'}>
                    {logError ? `${t('jobsPage.noLogs')} (${logError})` : t('jobsPage.noLogs')}
                  </Typography>
                ) : (
                  logs.slice(-1000).map(normalizeLog).map((log, i) => (
                    <Box
                      key={i}
                      sx={{
                        color: log.level === 'error' ? 'error.main' :
                               (log.level === 'warning' || log.level === 'warn') ? 'warning.main' :
                               log.level === 'success' ? 'success.main' :
                               log.level === 'step' ? 'primary.main' :
                               'text.primary',
                        // A phase of a warm migration (#1000): a header line.
                        ...(log.level === 'step' && { fontWeight: 700, mt: i === 0 ? 0 : 1 }),
                        lineHeight: 1.4,
                      }}
                    >
                      {log.timestamp && `[${new Date(log.timestamp).toLocaleTimeString()}]`}
                      {log.node && ` [${log.node}]`}
                      {' '}{log.message}
                    </Box>
                  ))
                )}
              </LiveLogBox>
            </CardContent>
          </Card>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
