'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  LinearProgress,
  Typography,
} from '@mui/material'

import { useTaskDetail } from '@/hooks/useTaskDetail'

interface DeploymentProgressProps {
  deploymentId: string
  onComplete: (status: 'completed' | 'failed', error?: string) => void
}

const STEPS = ['pending', 'downloading', 'creating', 'configuring', 'starting', 'completed'] as const

// Weighted progress per step (for the overall progress bar)
const STEP_WEIGHTS: Record<string, [number, number]> = {
  pending:      [0, 0],
  downloading:  [0, 50],
  creating:     [50, 80],
  configuring:  [80, 90],
  starting:     [90, 100],
  completed:    [100, 100],
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

export default function DeploymentProgress({ deploymentId, onComplete }: DeploymentProgressProps) {
  const t = useTranslations()
  const [status, setStatus] = useState<string>('pending')
  const [error, setError] = useState<string | null>(null)
  const [connectionId, setConnectionId] = useState<string | undefined>()
  const [node, setNode] = useState<string | undefined>()
  const [taskUpid, setTaskUpid] = useState<string | undefined>()
  const [showLogs, setShowLogs] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // PVE task detail — active when we have a UPID during downloading or creating
  const isTaskActive = !!taskUpid && ['downloading', 'creating'].includes(status)
  const { data: taskData } = useTaskDetail(
    isTaskActive ? connectionId : undefined,
    isTaskActive ? node : undefined,
    isTaskActive ? taskUpid : undefined,
    isTaskActive
  )

  useEffect(() => {
    if (!deploymentId) return

    let active = true
    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/templates/deployments/${deploymentId}`)
        const data = await res.json()
        const deployment = data.data
        if (!active || !deployment) return

        setStatus(deployment.status)
        setError(deployment.error)
        setConnectionId(deployment.connectionId)
        setNode(deployment.node)
        setTaskUpid(deployment.taskUpid || undefined)

        if (deployment.status === 'completed') {
          onComplete('completed')
          return
        }
        if (deployment.status === 'failed') {
          onComplete('failed', deployment.error)
          return
        }

        // Continue polling
        setTimeout(poll, 2000)
      } catch {
        if (active) setTimeout(poll, 5000)
      }
    }

    poll()
    return () => { active = false }
  }, [deploymentId, onComplete])

  // Auto-scroll logs
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

  const currentStepIndex = STEPS.indexOf(status as any)

  // Calculate weighted overall progress
  const calcOverallProgress = () => {
    if (status === 'completed') return 100
    if (status === 'failed') return 0

    const weights = STEP_WEIGHTS[status]
    if (!weights) return 0
    const [stepStart, stepEnd] = weights

    // If we have PVE task progress data for this step, interpolate within the step's range
    const taskProgress = (isTaskActive && taskData?.progress != null) ? taskData.progress : 0
    if (isTaskActive && taskProgress > 0) {
      return stepStart + ((stepEnd - stepStart) * taskProgress) / 100
    }

    // Otherwise just show the start of the step range
    return stepStart
  }

  const overallProgress = calcOverallProgress()
  const pveProgress = (isTaskActive && taskData?.progress != null) ? taskData.progress : null
  const pveSpeed = isTaskActive ? taskData?.speed : null
  const pveEta = isTaskActive ? taskData?.eta : null
  const pveLogs = isTaskActive ? (taskData?.logs || []) : []

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, py: 2 }}>
      {/* Overall progress bar */}
      <Box>
        <LinearProgress
          variant={status === 'completed' || status === 'failed' ? 'determinate' : 'buffer'}
          value={overallProgress}
          valueBuffer={Math.min(overallProgress + 10, 100)}
          color={status === 'failed' ? 'error' : status === 'completed' ? 'success' : 'primary'}
          sx={{ height: 8, borderRadius: 4 }}
        />
      </Box>

      {/* Step indicators */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {STEPS.filter(s => s !== 'pending').map((step, i) => {
          const stepIndex = STEPS.indexOf(step)
          const isActive = status === step
          const isDone = currentStepIndex > stepIndex || status === 'completed'
          const isFailed = status === 'failed' && currentStepIndex === stepIndex

          return (
            <Box key={step}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  opacity: isDone || isActive || isFailed ? 1 : 0.4,
                }}
              >
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
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
                    <CircularProgress size={18} sx={{ color: '#fff' }} />
                  ) : isDone ? (
                    <i className="ri-check-line" style={{ fontSize: 18 }} />
                  ) : isFailed ? (
                    <i className="ri-close-line" style={{ fontSize: 18 }} />
                  ) : (
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{i + 1}</Typography>
                  )}
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: isActive ? 600 : 400, color: isFailed ? 'error.main' : undefined }}
                  >
                    {t(`templates.deploy.progress.${step}` as any)}
                  </Typography>
                  {isFailed && error && (
                    <Typography variant="caption" color="error">
                      {error}
                    </Typography>
                  )}
                </Box>
              </Box>

              {/* PVE task detail for active step */}
              {isActive && isTaskActive && (
                <Box sx={{ ml: 5.5, mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {/* Determinate progress bar for PVE task */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <LinearProgress
                      variant={pveProgress != null && pveProgress > 0 ? 'determinate' : 'indeterminate'}
                      value={pveProgress || 0}
                      sx={{
                        flex: 1,
                        height: 6,
                        borderRadius: 3,
                        bgcolor: 'action.hover',
                        '& .MuiLinearProgress-bar': { borderRadius: 3 },
                      }}
                    />
                    {pveProgress != null && pveProgress > 0 && (
                      <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 40, textAlign: 'right' }}>
                        {Math.round(pveProgress)}%
                      </Typography>
                    )}
                  </Box>

                  {/* Speed and ETA badges */}
                  {(pveSpeed || pveEta) && (
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {pveSpeed && (
                        <Chip
                          icon={<i className="ri-speed-line" style={{ fontSize: 14 }} />}
                          label={pveSpeed}
                          size="small"
                          variant="outlined"
                          sx={{ height: 22, fontSize: '0.7rem' }}
                        />
                      )}
                      {pveEta && (
                        <Chip
                          icon={<i className="ri-time-line" style={{ fontSize: 14 }} />}
                          label={`~${pveEta}`}
                          size="small"
                          variant="outlined"
                          sx={{ height: 22, fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>
                  )}

                  {/* Show/Hide logs toggle */}
                  <Box
                    onClick={() => setShowLogs(!showLogs)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      cursor: 'pointer',
                      userSelect: 'none',
                      '&:hover': { opacity: 0.8 },
                    }}
                  >
                    <i
                      className={showLogs ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}
                      style={{ fontSize: 16, opacity: 0.6 }}
                    />
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>
                      {showLogs
                        ? t('templates.deploy.progress.hideLogs' as any)
                        : t('templates.deploy.progress.showLogs' as any)}
                    </Typography>
                  </Box>

                  {/* Collapsible log viewer */}
                  <Collapse in={showLogs}>
                    <Box
                      ref={logsContainerRef}
                      onScroll={handleScroll}
                      sx={{
                        maxHeight: 200,
                        overflow: 'auto',
                        bgcolor: '#0d1117',
                        borderRadius: 1,
                        fontFamily: 'monospace',
                        fontSize: 11,
                        lineHeight: 1.6,
                      }}
                    >
                      {pveLogs.length > 0 ? (
                        <Box sx={{ p: 1 }}>
                          {pveLogs.map((log: any, idx: number) => {
                            const logType = getLogType(log.t || '')
                            const logColor = getLogColor(logType)
                            return (
                              <Box
                                key={`${log.n}-${idx}`}
                                sx={{
                                  display: 'flex',
                                  py: 0.125,
                                  '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
                                }}
                              >
                                <Typography
                                  component="span"
                                  sx={{
                                    color: 'grey.600',
                                    minWidth: 32,
                                    textAlign: 'right',
                                    pr: 1,
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
                        <Box sx={{ p: 2, textAlign: 'center', color: 'grey.500', fontSize: 11 }}>
                          Waiting for logs...
                        </Box>
                      )}
                    </Box>
                  </Collapse>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
