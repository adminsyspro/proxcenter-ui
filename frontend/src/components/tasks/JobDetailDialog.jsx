'use client'

import { useEffect, useRef, useState } from 'react'

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

import { extractLogs, jobActions, jobDetailUrl, normalizeLog, syntheticLogs } from '@/lib/tasks/jobActions'
import { useCopyToClipboard } from '@/lib/clipboard'

import { StatusChip, TypeChip } from './JobChips'

// RemixIcon replacements for @mui/icons-material
const CheckCircleIcon = (props) => <i className="ri-checkbox-circle-fill" style={{ fontSize: props?.sx?.fontSize || 20, color: props?.sx?.color, ...props?.style }} />
const ErrorIcon = (props) => <i className="ri-error-warning-fill" style={{ fontSize: props?.sx?.fontSize || 20, color: props?.sx?.color, ...props?.style }} />
const WarningIcon = (props) => <i className="ri-alert-line" style={{ fontSize: props?.sx?.fontSize || 20, color: props?.sx?.color, ...props?.style }} />
const InfoIcon = (props) => <i className="ri-information-line" style={{ fontSize: props?.sx?.fontSize || 20, color: props?.sx?.color, ...props?.style }} />
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

/** Distance from the bottom still counted as "parked at the tail", in px. */
const TAIL_THRESHOLD_PX = 32

/**
 * Is this scroller parked at the tail?
 *
 * Exported so the follow rule can be asserted on a plain object: jsdom has no
 * layout engine, so a rendered log panel reports zero for all three metrics and
 * could never exercise this.
 */
export function isAtTail(el, threshold = TAIL_THRESHOLD_PX) {
  if (!el) return true

  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}

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

export default function JobDetailDialog({ open, onClose, job, onAction, actionError, isEnterprise, t }) {
  // Keyed by job id: the dialog is never unmounted, so a plain array kept
  // showing the previous job's logs under the next job opened.
  const [logState, setLogState] = useState({ jobId: null, entries: [], error: null })
  const forThisJob = logState.jobId && logState.jobId === job?.id
  const fetched = forThisJob ? logState.entries : []
  // Site Recovery has nothing to fetch: its record is the per-VM results the
  // row already carries.
  const logs = fetched.length > 0 ? fetched : syntheticLogs(job)
  // A refused read (a role with tasks.view but not automation.view on the
  // orchestrator routes) must say so rather than look like an empty log.
  const logError = forThisJob ? logState.error : null
  const [loading, setLoading] = useState(false)
  const logCopy = useCopyToClipboard()
  const logsRef = useRef(null)
  // Follow the tail only while the reader is parked at it. A job writes lines
  // for minutes, so yanking the view back down while they read an earlier line
  // is worse than not following at all.
  const followTail = useRef(true)
  // Held per job id rather than as a boolean: a stale confirmation must never
  // carry over to the next job opened in this (permanently mounted) dialog.
  const [confirmCancelFor, setConfirmCancelFor] = useState(null)
  const confirmCancel = open && !!job?.id && confirmCancelFor === job.id

  const detailUrl = jobDetailUrl(job)

  // Fetch full job details when dialog opens
  useEffect(() => {
    if (open && detailUrl && isEnterprise) {
      fetchJobDetails()
    }
  }, [open, detailUrl, isEnterprise])

  const fetchJobDetails = async ({ silent = false } = {}) => {
    if (!detailUrl || !isEnterprise) return

    // A background refresh must not raise the spinner: on a running job it
    // fires every 3 s and the header blinked continuously.
    if (!silent) setLoading(true)
    try {
      const res = await fetch(detailUrl)
      if (res.ok) {
        const data = await res.json()
        setLogState({ jobId: job.id, entries: extractLogs(data), error: null })
      } else {
        setLogState({ jobId: job.id, entries: [], error: `HTTP ${res.status}` })
      }
    } catch (e) {
      console.error('Error fetching job details:', e)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // Auto-refresh if job is running
  useEffect(() => {
    if (open && detailUrl && job?.status === 'running' && isEnterprise) {
      const interval = setInterval(() => fetchJobDetails({ silent: true }), 3000)
      return () => clearInterval(interval)
    }
  }, [open, detailUrl, job?.status, isEnterprise])

  // Reopening the dialog, or opening it on another job, starts at the tail
  // again: the ref survives, the dialog is never unmounted.
  useEffect(() => {
    followTail.current = true
  }, [open, job?.id])

  // Scroll with the job. Keyed on the line count, which is what the 3 s refresh
  // above changes while a migration runs.
  useEffect(() => {
    if (!open) return
    const el = logsRef.current
    if (!el || !followTail.current) return
    el.scrollTop = el.scrollHeight
  }, [open, logs.length])

  if (!job) return null

  const nodeStatuses = job.metadata?.nodeStatuses || []
  const actions = jobActions(job)
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
          {actions.length > 0 && !confirmCancel && (
            <Box sx={{ display: 'flex', gap: 1 }}>
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
              <Box
                ref={logsRef}
                onScroll={() => { followTail.current = isAtTail(logsRef.current) }}
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
                  logs.slice(-100).map(normalizeLog).map((log, i) => (
                    <Box
                      key={i}
                      sx={{
                        color: log.level === 'error' ? 'error.main' :
                               (log.level === 'warning' || log.level === 'warn') ? 'warning.main' :
                               log.level === 'success' ? 'success.main' :
                               'text.primary',
                        lineHeight: 1.4,
                      }}
                    >
                      {log.timestamp && `[${new Date(log.timestamp).toLocaleTimeString()}]`}
                      {log.node && ` [${log.node}]`}
                      {' '}{log.message}
                    </Box>
                  ))
                )}
              </Box>
            </CardContent>
          </Card>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
