'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Snackbar,
  Tooltip,
  Typography,
  useTheme
} from '@mui/material'

import { useTaskDetail } from '@/hooks/useTaskDetail'

/* --------------------------------
   Helpers
-------------------------------- */

function formatTaskType(type, t) {
  // Use translation keys from tasks.types
  const key = `tasks.types.${type}`
  const translated = t(key)
  // If translation returns the key itself, return the raw type
  return translated === key ? type : translated
}

function getStatusColor(status) {
  if (!status || status === 'running') return 'primary'
  if (status === 'OK') return 'success'
  if (status.includes && status.includes('WARNINGS')) return 'warning'
  if (status.includes && status.includes('migration problems')) return 'warning'
  if (status.includes && (status.includes('received interrupt') || status.includes('interrupted by user'))) return 'warning'

return 'error'
}

function getStatusLabel(status, t) {
  if (!status || status === 'running') return t('tasks.status.running')
  if (status === 'OK') return t('tasks.status.completed')
  if (status === 'stopped') return t('tasks.status.stopped')
  if (status.includes && status.includes('migration problems')) return t('tasks.status.completedWithWarnings', { defaultMessage: 'Completed (warnings)' })
  if (status.includes && (status.includes('received interrupt') || status.includes('interrupted by user'))) return t('tasks.status.stopped')
  return status
}

function getLogType(text) {
  const t = text.toLowerCase()

  if (t.includes('error') || t.includes('failed')) return 'error'
  if (t.includes('warning')) return 'warning'
  if (t.includes('%') || t.includes('transferred')) return 'transfer'

return 'info'
}

function getLogColor(type, theme) {
  switch (type) {
    case 'error': return theme?.palette?.error?.light || '#f85149'
    case 'warning': return theme?.palette?.warning?.light || '#d29922'
    case 'transfer': return theme?.palette?.primary?.light || '#58a6ff'
    default: return theme?.palette?.primary?.light || '#c9d1d9'
  }
}

/* --------------------------------
   Component
-------------------------------- */

export default function TaskDetailDialog({ open, task, onClose }) {
  const t = useTranslations()
  const theme = useTheme()
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [snackbar, setSnackbar] = useState({ open: false, message: '' })
  const [stopping, setStopping] = useState(false)

  const logsContainerRef = useRef(null)
  const logsEndRef = useRef(null)
  const prevLogsLengthRef = useRef(0)

  // SWR hook for task details
  const isRunningInput = task?.status === 'running' || !task?.status
  const { data: fetchedDetails } = useTaskDetail(
    open ? task?.connectionId : undefined,
    open ? task?.node : undefined,
    open ? task?.id : undefined,
    isRunningInput
  )

  // Sync fetched details to local state
  useEffect(() => {
    if (fetchedDetails) {
      setDetails(fetchedDetails)
      setLoading(false)
      setError(null)
      if (fetchedDetails.logs?.length > prevLogsLengthRef.current) {
        prevLogsLengthRef.current = fetchedDetails.logs.length
        setTimeout(scrollToBottom, 100)
      }
    }
  }, [fetchedDetails])

  // Reset state when dialog opens
  useEffect(() => {
    if (open && task) {
      setLoading(true)
      setDetails(null)
      setError(null)
      setAutoScroll(true)
      setStopping(false)
      prevLogsLengthRef.current = 0
    }
  }, [open, task?.id])

  // Scroll to bottom
  const scrollToBottom = () => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }

  // Detect manual scroll to disable auto-scroll
  const handleScroll = () => {
    if (!logsContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current

    // If user scrolled up more than 100px from bottom, disable auto-scroll
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100

    setAutoScroll(isAtBottom)
  }

  // Copy logs to clipboard
  const handleCopyLogs = async () => {
    if (!details?.logs) return

    const logsText = details.logs
      .map(l => `${l.n.toString().padStart(4, ' ')} ${l.t}`)
      .join('\n')

    try {
      await navigator.clipboard.writeText(logsText)
      setSnackbar({ open: true, message: t('common.copied') })
    } catch (e) {
      setSnackbar({ open: true, message: t('common.error') })
    }
  }

  // Stop task
  const handleStopTask = async () => {
    if (!task?.connectionId || !task?.node || !task?.id) return

    setStopping(true)

    try {
      const res = await fetch(
        `/api/v1/tasks/${encodeURIComponent(task.connectionId)}/${encodeURIComponent(task.node)}/${encodeURIComponent(task.id)}`,
        { method: 'DELETE' }
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to stop task')
      }

      setSnackbar({ open: true, message: t('tasks.detail.taskStopped') })
    } catch (e) {
      setSnackbar({ open: true, message: e.message || t('common.error') })
      setStopping(false)
    }
  }

  const filteredLogs = details?.logs || []

  if (!task) return null

  const isRunning = details?.status === 'running' || (!details && task.status === 'running')
  const progress = details?.progress ?? 0
  const statusColor = getStatusColor(details?.exitstatus || details?.status || task.status)


  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            backgroundImage: 'none'
          }
        }}
      >
        <DialogTitle sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid',
          borderColor: 'divider',
          pb: 1.5
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 1,
                bgcolor: isRunning ? 'primary.main' : statusColor === 'success' ? 'success.main' : 'error.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <i
                className={isRunning ? 'ri-loader-4-line' : statusColor === 'success' ? 'ri-check-line' : 'ri-close-line'}
                style={{
                  fontSize: 20,
                  color: '#fff',
                  animation: isRunning ? 'spin 1s linear infinite' : 'none'
                }}
              />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                {task.typeLabel || formatTaskType(task.type, t)}
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={onClose} size="small">
            <i className="ri-close-line" style={{ fontSize: 20 }} />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ p: 0 }}>
          {/* Info bar */}
          <Box sx={{
            display: 'flex',
            justifyContent: 'space-between',
            px: 3,
            py: 2,
            bgcolor: 'action.hover',
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexWrap: 'wrap',
            gap: 2
          }}>
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.5, display: 'block' }}>{t('tasks.detail.node')}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
                  <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                  <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: 'success.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>{task.node}</Typography>
              </Box>
            </Box>
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.5, display: 'block' }}>{t('tasks.detail.user')}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>{details?.user || task.user || '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.5, display: 'block' }}>{t('tasks.detail.duration')}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>{details?.duration || task.duration || '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.5, display: 'block' }}>{t('common.status')}</Typography>
              <Chip
                size="small"
                label={getStatusLabel(details?.exitstatus || details?.status || task.status, t)}
                color={statusColor}
                variant={isRunning ? 'outlined' : 'filled'}
              />
            </Box>
            {isRunning && (
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Tooltip title={stopping ? t('tasks.detail.stopping') : t('tasks.detail.stop')}>
                  <span>
                    <IconButton
                      onClick={handleStopTask}
                      disabled={stopping}
                      size="small"
                      sx={{ color: 'error.main' }}
                    >
                      <i
                        className={stopping ? 'ri-loader-4-line' : 'ri-stop-circle-line'}
                        style={{ fontSize: 20, ...(stopping ? { animation: 'spin 1s linear infinite' } : {}) }}
                      />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            )}
          </Box>

          {/* Progress section — only shown when the task actually carries
              progress data (message, speed, percent > 0). Most PVE tasks
              (vncproxy, qmstart, qmshutdown, etc.) don't emit progress at
              all; for those, the Status chip + logs are sufficient feedback.
              Showing a perpetually-indeterminate bar at "0%" on those tasks
              was confusing (looked broken) and added no information. */}
          {(progress > 0 || details?.message || details?.speed) && (
            <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {details?.message || t('tasks.detail.loading')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {details?.speed && (
                    <Typography variant="body2" sx={{ opacity: 0.7, fontSize: 12 }}>
                      <i className="ri-speed-line" style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      {details.speed}
                    </Typography>
                  )}
                  {details?.eta && isRunning && (
                    <Typography variant="body2" sx={{ opacity: 0.7, fontSize: 12 }}>
                      <i className="ri-time-line" style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      ~{details.eta}
                    </Typography>
                  )}
                  <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 45, textAlign: 'right' }}>
                    {Math.round(progress)}%
                  </Typography>
                </Box>
              </Box>
              <LinearProgress
                variant={isRunning && progress === 0 ? 'indeterminate' : 'determinate'}
                value={progress}
                sx={{
                  height: 8,
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 1
                  }
                }}
              />
            </Box>
          )}

          {/* Error display */}
          {error && (
            <Box sx={{ px: 3, py: 2, bgcolor: 'error.main', color: 'error.contrastText' }}>
              <Typography variant="body2">{error}</Typography>
            </Box>
          )}

          {/* Logs toolbar */}
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 1,
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            bgcolor: '#161b22'
          }}>
            <Box sx={{ flex: 1 }} />

            <Tooltip title={autoScroll ? t('tasks.detail.autoScrollEnabled') : t('tasks.detail.autoScrollDisabled')}>
              <IconButton
                size="small"
                onClick={() => {
                  setAutoScroll(true)
                  scrollToBottom()
                }}
                sx={{
                  opacity: autoScroll ? 1 : 0.5,
                  color: autoScroll ? 'primary.main' : 'inherit'
                }}
              >
                <i className="ri-arrow-down-line" style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>

            <Tooltip title={t('tasks.detail.copyLogs')}>
              <IconButton size="small" onClick={handleCopyLogs}>
                <i className="ri-file-copy-line" style={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>

          {/* Logs */}
          <Box
            ref={logsContainerRef}
            onScroll={handleScroll}
            sx={{
              height: 320,
              overflow: 'auto',
              bgcolor: '#0d1117',
              fontFamily: 'monospace',
              fontSize: 12,
              lineHeight: 1.6
            }}
          >
            {loading && !details ? (
              <Box sx={{ p: 3, textAlign: 'center', color: 'grey.500' }}>
                {t('tasks.detail.loadingLogs')}
              </Box>
            ) : filteredLogs.length > 0 ? (
              <Box sx={{ p: 1.5 }}>
                {details?.totalLogLines > (details?.logs?.length || 0) && (
                  <Box sx={{
                    py: 0.75,
                    px: 1.5,
                    mb: 1,
                    borderRadius: 0.5,
                    bgcolor: `${theme.palette.primary.main}14`,
                    border: `1px solid ${theme.palette.primary.main}33`,
                    color: theme.palette.primary.main,
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5
                  }}>
                    <i className="ri-information-line" />
                    {t('tasks.detail.logsTruncated', {
                      shown: details.logs.length.toLocaleString(),
                      total: details.totalLogLines.toLocaleString()
                    })}
                  </Box>
                )}
                {filteredLogs.map((log, idx) => {
                  const logType = getLogType(log.t)
                  const logColor = getLogColor(logType, theme)

                  return (
                    <Box
                      key={`${log.n}-${idx}`}
                      sx={{
                        display: 'flex',
                        py: 0.25,
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' }
                      }}
                    >
                      <Typography
                        component="span"
                        sx={{
                          color: 'grey.600',
                          minWidth: 40,
                          textAlign: 'right',
                          pr: 1.5,
                          userSelect: 'none',
                          fontFamily: 'inherit',
                          fontSize: 'inherit'
                        }}
                      >
                        {log.n}
                      </Typography>
                      <Typography
                        component="span"
                        sx={{
                          color: logColor,
                          fontFamily: 'inherit',
                          fontSize: 'inherit',
                          wordBreak: 'break-all'
                        }}
                      >
                        {log.t}
                      </Typography>
                    </Box>
                  )
                })}
                <div ref={logsEndRef} />
              </Box>
            ) : (
              <Box sx={{ p: 3, textAlign: 'center', color: 'grey.500' }}>
                {t('tasks.detail.noLogsAvailable')}
              </Box>
            )}
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          {isRunning && (
            <Typography variant="caption" sx={{ opacity: 0.5, mr: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <i className="ri-refresh-line" style={{ animation: 'spin 2s linear infinite' }} />
              {t('tasks.detail.autoUpdate')}
            </Typography>
          )}
          <Button onClick={onClose} variant="outlined">
            {t('common.close')}
          </Button>
        </DialogActions>

        {/* Keyframes for spinner */}
        <style jsx global>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </Dialog>

      {/* Snackbar for copy feedback */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={2000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  )
}
