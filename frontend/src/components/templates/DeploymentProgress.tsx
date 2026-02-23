'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  CircularProgress,
  LinearProgress,
  Typography,
} from '@mui/material'

interface DeploymentProgressProps {
  deploymentId: string
  onComplete: (status: 'completed' | 'failed', error?: string) => void
}

const STEPS = ['pending', 'downloading', 'creating', 'configuring', 'starting', 'completed'] as const

export default function DeploymentProgress({ deploymentId, onComplete }: DeploymentProgressProps) {
  const t = useTranslations()
  const [status, setStatus] = useState<string>('pending')
  const [error, setError] = useState<string | null>(null)

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

        if (deployment.status === 'completed') {
          onComplete('completed')
          return
        }
        if (deployment.status === 'failed') {
          onComplete('failed', deployment.error)
          return
        }

        // Continue polling
        setTimeout(poll, 3000)
      } catch {
        if (active) setTimeout(poll, 5000)
      }
    }

    poll()
    return () => { active = false }
  }, [deploymentId, onComplete])

  const currentStepIndex = STEPS.indexOf(status as any)
  const progress = status === 'completed'
    ? 100
    : status === 'failed'
      ? 0
      : Math.max(0, (currentStepIndex / (STEPS.length - 1)) * 100)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, py: 2 }}>
      {/* Progress bar */}
      <Box>
        <LinearProgress
          variant={status === 'completed' || status === 'failed' ? 'determinate' : 'buffer'}
          value={progress}
          valueBuffer={progress + 15}
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
            <Box
              key={step}
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
              <Box>
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
          )
        })}
      </Box>
    </Box>
  )
}
