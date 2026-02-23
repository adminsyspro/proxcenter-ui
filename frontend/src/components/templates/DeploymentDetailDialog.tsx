'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
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
  Typography,
} from '@mui/material'

import { useTaskDetail } from '@/hooks/useTaskDetail'

interface Deployment {
  id: string
  blueprintId: string | null
  blueprintName: string | null
  connectionId: string
  node: string
  vmid: number
  vmName: string | null
  imageSlug: string | null
  status: string
  currentStep: string | null
  error: string | null
  taskUpid: string | null
  config: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

interface DeploymentDetailDialogProps {
  open: boolean
  deployment: Deployment | null
  onClose: () => void
}

const STEPS = ['pending', 'downloading', 'creating', 'configuring', 'starting', 'completed'] as const

const STATUS_COLORS: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  completed: 'success',
  failed: 'error',
  pending: 'default',
  downloading: 'info',
  creating: 'info',
  configuring: 'info',
  starting: 'warning',
}

function getLogType(text: string) {
  const t = text.toLowerCase()
  if (t.includes('error') || t.includes('failed')) return 'error'
  if (t.includes('warning')) return 'warning'
  if (t.includes('%') || t.includes('transferred')) return 'transfer'
  return 'info'
}

function getLogColor(type: string) {
  switch (type) {
    case 'error': return '#f85149'
    case 'warning': return '#d29922'
    case 'transfer': return '#58a6ff'
    default: return '#c9d1d9'
  }
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return '—'
  const startDate = new Date(start)
  const endDate = end ? new Date(end) : new Date()
  const seconds = Math.floor((endDate.getTime() - startDate.getTime()) / 1000)
  if (seconds < 0) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

export default function DeploymentDetailDialog({ open, deployment, onClose }: DeploymentDetailDialogProps) {
  const t = useTranslations()
  const [logFilter, setLogFilter] = useState('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [snackbar, setSnackbar] = useState({ open: false, message: '' })
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // PVE task detail
  const isRunning = !!deployment && !['completed', 'failed'].includes(deployment.status)
  const hasTask = !!deployment?.taskUpid
  const { data: taskData } = useTaskDetail(
    open && hasTask ? deployment?.connectionId : undefined,
    open && hasTask ? deployment?.node : undefined,
    open && hasTask ? (deployment?.taskUpid || undefined) : undefined,
    isRunning && hasTask
  )

  // Reset on open
  useEffect(() => {
    if (open) {
      setLogFilter('all')
      setAutoScroll(true)
    }
  }, [open, deployment?.id])

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [taskData?.logs?.length, autoScroll])

  const handleScroll = () => {
    if (!logsContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 100)
  }

  const handleCopyLogs = async () => {
    if (!taskData?.logs) return
    const logsText = taskData.logs
      .map((l: any) => `${String(l.n).padStart(4, ' ')} ${l.t}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(logsText)
      setSnackbar({ open: true, message: t('common.copied') })
    } catch {
      setSnackbar({ open: true, message: t('common.error') })
    }
  }

  if (!deployment) return null

  const currentStepIndex = STEPS.indexOf(deployment.status as any)
  const progress = taskData?.progress ?? 0
  const logs = taskData?.logs || []

  const filteredLogs = logs.filter((log: any) => {
    if (logFilter === 'all') return true
    const type = getLogType(log.t)
    if (logFilter === 'errors') return type === 'error'
    if (logFilter === 'warnings') return type === 'warning' || type === 'error'
    if (logFilter === 'transfers') return type === 'transfer'
    return true
  })

  const logCounts = {
    all: logs.length,
    errors: logs.filter((l: any) => getLogType(l.t) === 'error').length,
    warnings: logs.filter((l: any) => ['error', 'warning'].includes(getLogType(l.t))).length,
    transfers: logs.filter((l: any) => getLogType(l.t) === 'transfer').length,
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid',
          borderColor: 'divider',
          pb: 1.5,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 1,
                bgcolor: deployment.status === 'completed' ? 'success.main'
                  : deployment.status === 'failed' ? 'error.main'
                  : 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <i
                className={
                  isRunning ? 'ri-loader-4-line'
                  : deployment.status === 'completed' ? 'ri-check-line'
                  : 'ri-close-line'
                }
                style={{
                  fontSize: 20,
                  color: '#fff',
                  animation: isRunning ? 'spin 1s linear infinite' : 'none',
                }}
              />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                {deployment.vmName || `VM ${deployment.vmid}`}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.6 }}>
                VMID: {deployment.vmid} &middot; {deployment.node}
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
            flexWrap: 'wrap',
          }}>
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.5, display: 'block' }}>
                {t('templates.deploy.target.node')}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>{deployment.node}</Typography>
            </Box>
            {deployment.imageSlug && (
              <Box>
                <Typography variant="caption" sx={{ opacity: 0.5, display: 'block' }}>
                  {t('templates.deployments.image')}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>{deployment.imageSlug}</Typography>
              </Box>
            )}
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.5, display: 'block' }}>
                {t('common.status')}
              </Typography>
              <Chip
                size="small"
                label={t(`templates.deployments.status.${deployment.status}` as any) || deployment.status}
                color={STATUS_COLORS[deployment.status] || 'default'}
                variant={isRunning ? 'outlined' : 'filled'}
              />
            </Box>
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.5, display: 'block' }}>
                {t('templates.deployments.started')}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {deployment.startedAt ? new Date(deployment.startedAt).toLocaleString() : '—'}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.5, display: 'block' }}>
                {t('tasks.detail.duration')}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {formatDuration(deployment.startedAt, deployment.completedAt)}
              </Typography>
            </Box>
          </Box>

          {/* Deployment steps stepper */}
          <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {STEPS.filter(s => s !== 'pending').map((step, i) => {
                const stepIndex = STEPS.indexOf(step)
                const isActive = deployment.status === step
                const isDone = currentStepIndex > stepIndex || deployment.status === 'completed'
                const isFailed = deployment.status === 'failed' && currentStepIndex === stepIndex

                return (
                  <Box
                    key={step}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      opacity: isDone || isActive || isFailed ? 1 : 0.4,
                    }}
                  >
                    <Box
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        bgcolor: isDone
                          ? 'success.main'
                          : isFailed
                            ? 'error.main'
                            : isActive
                              ? 'primary.main'
                              : 'action.hover',
                        color: isDone || isActive || isFailed ? '#fff' : 'text.secondary',
                      }}
                    >
                      {isActive && !isDone ? (
                        <CircularProgress size={14} sx={{ color: '#fff' }} />
                      ) : isDone ? (
                        <i className="ri-check-line" style={{ fontSize: 14 }} />
                      ) : isFailed ? (
                        <i className="ri-close-line" style={{ fontSize: 14 }} />
                      ) : (
                        <Typography sx={{ fontSize: 10, fontWeight: 600 }}>{i + 1}</Typography>
                      )}
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 400,
                        color: isFailed ? 'error.main' : undefined,
                      }}
                    >
                      {t(`templates.deploy.progress.${step}` as any)}
                    </Typography>
                  </Box>
                )
              })}
            </Box>
          </Box>

          {/* PVE task progress */}
          {hasTask && (isRunning || progress > 0) && (
            <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {taskData?.message || t('tasks.detail.loading')}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {taskData?.speed && (
                    <Typography variant="body2" sx={{ opacity: 0.7, fontSize: 12 }}>
                      <i className="ri-speed-line" style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      {taskData.speed}
                    </Typography>
                  )}
                  {taskData?.eta && isRunning && (
                    <Typography variant="body2" sx={{ opacity: 0.7, fontSize: 12 }}>
                      <i className="ri-time-line" style={{ marginRight: 4, verticalAlign: 'middle' }} />
                      ~{taskData.eta}
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
                  '& .MuiLinearProgress-bar': { borderRadius: 1 },
                }}
              />
            </Box>
          )}

          {/* Error display */}
          {deployment.status === 'failed' && deployment.error && (
            <Box sx={{ px: 3, py: 2, bgcolor: 'error.main', color: 'error.contrastText' }}>
              <Typography variant="body2">{deployment.error}</Typography>
            </Box>
          )}

          {/* Logs section — only when we have a taskUpid */}
          {hasTask && (
            <>
              {/* Logs toolbar */}
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1,
                borderBottom: '1px solid',
                borderColor: 'divider',
                bgcolor: '#161b22',
              }}>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <Select
                    value={logFilter}
                    onChange={e => setLogFilter(e.target.value)}
                    sx={{
                      fontSize: 12,
                      '& .MuiSelect-select': { py: 0.5 },
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
                      if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
                    }}
                    sx={{
                      opacity: autoScroll ? 1 : 0.5,
                      color: autoScroll ? 'primary.main' : 'inherit',
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
                  height: 260,
                  overflow: 'auto',
                  bgcolor: '#0d1117',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                {filteredLogs.length > 0 ? (
                  <Box sx={{ p: 1.5 }}>
                    {filteredLogs.map((log: any, idx: number) => {
                      const logType = getLogType(log.t)
                      const logColor = getLogColor(logType)
                      return (
                        <Box
                          key={`${log.n}-${idx}`}
                          sx={{
                            display: 'flex',
                            py: 0.25,
                            '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
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
                              fontSize: 'inherit',
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
                              wordBreak: 'break-all',
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
            </>
          )}
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

        <style jsx global>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </Dialog>

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
