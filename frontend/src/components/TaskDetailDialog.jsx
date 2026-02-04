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
  FormControl,
  IconButton,
  LinearProgress,
  MenuItem,
  Select,
  Snackbar,
  Tooltip,
  Typography
} from '@mui/material'

/* --------------------------------
   Helpers
-------------------------------- */

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' })

  if (!r.ok) {
    const text = await r.text()

    throw new Error(text || `HTTP ${r.status}`)
  }

  
return r.json()
}

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
  
return 'error'
}

function getStatusLabel(status, t) {
  if (!status || status === 'running') return t('tasks.status.running')
  if (status === 'OK') return t('tasks.status.completed')
  if (status === 'stopped') return t('tasks.status.stopped')
  return status
}

function getLogType(text) {
  const t = text.toLowerCase()

  if (t.includes('error') || t.includes('failed')) return 'error'
  if (t.includes('warning')) return 'warning'
  if (t.includes('%') || t.includes('transferred')) return 'transfer'
  
return 'info'
}

function getLogColor(type) {
  switch (type) {
    case 'error': return '#f85149'
    case 'warning': return '#d29922'
    case 'transfer': return '#58a6ff'
    default: return '#c9d1d9'
  }
}

/* --------------------------------
   Component
-------------------------------- */

export default function TaskDetailDialog({ open, task, onClose }) {
  const t = useTranslations()
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [logFilter, setLogFilter] = useState('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [snackbar, setSnackbar] = useState({ open: false, message: '' })
  
  const logsContainerRef = useRef(null)
  const logsEndRef = useRef(null)
  const intervalRef = useRef(null)
  const prevLogsLengthRef = useRef(0)

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

  // Filter logs
  const filteredLogs = details?.logs?.filter(log => {
    if (logFilter === 'all') return true
    const type = getLogType(log.t)

    if (logFilter === 'errors') return type === 'error'
    if (logFilter === 'warnings') return type === 'warning' || type === 'error'
    if (logFilter === 'transfers') return type === 'transfer'
    
return true
  }) || []

  // Fetch task details
  const fetchDetails = async () => {
    if (!task) return

    try {
      const upidEncoded = encodeURIComponent(task.id)
      const url = `/api/v1/tasks/${task.connectionId}/${task.node}/${upidEncoded}`
      const data = await fetchJson(url)

      setDetails(data)
      setError(null)

      // Auto-scroll if new logs appeared and task is running
      if (data.logs?.length > prevLogsLengthRef.current) {
        prevLogsLengthRef.current = data.logs.length
        setTimeout(scrollToBottom, 100)
      }

      // Stop polling if task is complete
      if (data.status === 'stopped' && intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    } catch (e) {
      setError(e?.message || t('errors.loadingError'))
    }
  }

  // Start/stop polling based on dialog state
  useEffect(() => {
    if (open && task) {
      setLoading(true)
      setDetails(null)
      setError(null)
      setAutoScroll(true)
      prevLogsLengthRef.current = 0

      // Initial fetch
      fetchDetails().finally(() => setLoading(false))

      // Poll every 2s if task is running
      if (task.status === 'running' || !task.status) {
        intervalRef.current = setInterval(fetchDetails, 2000)
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [open, task?.id])

  // Scroll when filter changes
  useEffect(() => {
    if (autoScroll) {
      setTimeout(scrollToBottom, 50)
    }
  }, [logFilter])

  if (!task) return null

  const isRunning = details?.status === 'running' || (!details && task.status === 'running')
  const progress = details?.progress ?? 0
  const statusColor = getStatusColor(details?.exitstatus || details?.status || task.status)

  // Count logs by type
  const logCounts = {
    all: details?.logs?.length || 0,
    errors: details?.logs?.filter(l => getLogType(l.t) === 'error').length || 0,
    warnings: details?.logs?.filter(l => ['error', 'warning'].includes(getLogType(l.t))).length || 0,
    transfers: details?.logs?.filter(l => getLogType(l.t) === 'transfer').length || 0
  }

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
              <Typography variant="body2" sx={{ opacity: 0.6 }}>
                {task.entity || task.node} • {task.connectionName}
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
            gap: 3,
            px: 3,
            py: 2,
            bgcolor: 'action.hover',
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexWrap: 'wrap'
          }}>
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.5, display: 'block' }}>{t('tasks.detail.node')}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>{task.node}</Typography>
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
          </Box>

          {/* Progress section */}
          {(isRunning || progress > 0) && (
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
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: '#161b22'
          }}>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <Select
                value={logFilter}
                onChange={e => setLogFilter(e.target.value)}
                sx={{
                  fontSize: 12,
                  '& .MuiSelect-select': { py: 0.5 }
                }}
              >
                <MenuItem value="all">{t('tasks.detail.allLogs')} ({logCounts.all})</MenuItem>
                <MenuItem value="errors">{t('tasks.detail.errors')} ({logCounts.errors})</MenuItem>
                <MenuItem value="warnings">{t('tasks.detail.warnings')} ({logCounts.warnings})</MenuItem>
                <MenuItem value="transfers">{t('tasks.detail.transfers')} ({logCounts.transfers})</MenuItem>
              </Select>
            </FormControl>

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
                {filteredLogs.map((log, idx) => {
                  const logType = getLogType(log.t)
                  const logColor = getLogColor(logType)
                  
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
                {logFilter === 'all' ? t('tasks.detail.noLogsAvailable') : t('tasks.detail.noMatchingLogs')}
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