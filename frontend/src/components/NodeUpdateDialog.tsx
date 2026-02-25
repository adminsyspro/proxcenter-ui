'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  Typography,
} from '@mui/material'

interface NodeUpdateDialogProps {
  open: boolean
  onClose: () => void
  connectionId: string
  nodeName: string
  vmCount: number
  nodeUpdates: Record<string, { count: number; updates: any[]; version: string | null }>
}

type UpgradeStatus = 'UNKNOWN' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REBOOTING'

export default function NodeUpdateDialog({
  open,
  onClose,
  connectionId,
  nodeName,
  vmCount,
  nodeUpdates,
}: NodeUpdateDialogProps) {
  const t = useTranslations()

  const steps = [t('updates.stepConfiguration'), t('updates.stepUpdate'), t('updates.stepCompleted')]
  const [activeStep, setActiveStep] = useState(0)

  // Config
  const [autoReboot, setAutoReboot] = useState(true)

  // Execution
  const [loading, setLoading] = useState(false)
  const [upgradeStatus, setUpgradeStatus] = useState<UpgradeStatus>('UNKNOWN')
  const [upgradeLogs, setUpgradeLogs] = useState<string>('')
  const [rebootRequired, setRebootRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<Date | null>(null)
  const [completedAt, setCompletedAt] = useState<Date | null>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const logsEndRef = useRef<HTMLDivElement | null>(null)

  // SSH check
  const [sshNotConfigured, setSshNotConfigured] = useState(false)

  // Repository check
  const [repoIssues, setRepoIssues] = useState<string[]>([])
  const [repoChecking, setRepoChecking] = useState(false)

  const nodeUpdate = nodeUpdates?.[nodeName]
  const pkgCount = nodeUpdate?.count || 0

  const baseUrl = `/api/v1/connections/${connectionId}/nodes/${encodeURIComponent(nodeName)}/upgrade`

  // Check SSH + repository configuration when dialog opens
  useEffect(() => {
    if (!open || !connectionId || !nodeName) return

    let cancelled = false
    setSshNotConfigured(false)
    setRepoChecking(true)
    setRepoIssues([])

    // Check SSH enabled on connection
    fetch(`/api/v1/connections/${connectionId}`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return
        if (!json.sshEnabled) setSshNotConfigured(true)
      })
      .catch(() => {})

    fetch(`/api/v1/connections/${connectionId}/nodes/${encodeURIComponent(nodeName)}/apt/repositories`)
      .then(res => res.json())
      .then(json => {
        if (cancelled || !json.data?.standard_repos) return

        const repos = json.data.standard_repos as Array<{ handle: string; status: boolean | null; name: string }>
        const status: Record<string, boolean | null> = {}
        for (const r of repos) {
          status[r.handle] = r.status
        }

        const issues: string[] = []

        if (status['enterprise'] === true && status['no-subscription'] !== true) {
          issues.push('PVE Enterprise repository is enabled without a no-subscription alternative. apt update will fail without a valid PVE subscription.')
        }

        for (const [handle, s] of Object.entries(status)) {
          if (s === true && handle.endsWith('-enterprise') && handle !== 'enterprise') {
            const base = handle.replace(/-enterprise$/, '')
            if (status[`${base}-no-subscription`] !== true) {
              issues.push(`${base} enterprise repository is enabled without a no-subscription alternative.`)
            }
          }
        }

        if (json.data.errors?.length) {
          for (const e of json.data.errors) {
            issues.push(`Repository error: ${e.message}`)
          }
        }

        setRepoIssues(issues)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRepoChecking(false)
      })

    return () => { cancelled = true }
  }, [open, connectionId, nodeName])

  // Cleanup polling
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [])

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [upgradeLogs])

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(baseUrl)
      const json = await res.json()

      if (!res.ok) return

      const status = json.status as UpgradeStatus
      setUpgradeStatus(status)
      setUpgradeLogs(json.logs || '')
      setRebootRequired(json.reboot_required || false)

      if (['COMPLETED', 'FAILED'].includes(status)) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
        setCompletedAt(new Date())
        setActiveStep(2)

        // Auto-reboot if enabled, upgrade succeeded, and reboot is needed
        if (status === 'COMPLETED' && json.reboot_required && autoReboot) {
          try {
            await fetch(`${baseUrl}/reboot`, { method: 'POST' })
            setRebootRequired(false)
          } catch {}
        }
      }
    } catch {
      // ignore polling errors (node may be rebooting)
    }
  }, [baseUrl, autoReboot])

  const startUpdate = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_reboot: autoReboot }),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || 'Failed to start update')
      }

      setStartedAt(new Date())
      setUpgradeStatus('RUNNING')
      setUpgradeLogs('')
      setActiveStep(1)

      // Poll for status every 3s
      const interval = setInterval(pollStatus, 3000)
      pollingRef.current = interval

      // First poll immediately after a short delay
      setTimeout(pollStatus, 1500)
    } catch (e: any) {
      setError(e.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [baseUrl, autoReboot, pollStatus])

  const cancelUpdate = useCallback(async () => {
    try {
      await fetch(`/api/v1/connections/${connectionId}/nodes/${encodeURIComponent(nodeName)}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancel: true }),
      })
      // Best-effort: kill apt process on the node
      // The status file will eventually show FAILED
    } catch {}
  }, [connectionId, nodeName])

  const handleClose = () => {
    if (upgradeStatus === 'RUNNING') {
      if (!window.confirm(t('updates.confirmCloseWhileRunning'))) {
        return
      }
    }

    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    setActiveStep(0)
    setUpgradeStatus('UNKNOWN')
    setUpgradeLogs('')
    setRebootRequired(false)
    setError(null)
    setAutoReboot(true)
    setStartedAt(null)
    setCompletedAt(null)
    onClose()
  }

  const rebootNode = useCallback(async () => {
    try {
      await fetch(`${baseUrl}/reboot`, { method: 'POST' })
      setRebootRequired(false)
    } catch {}
  }, [baseUrl])

  // Compute duration string
  const getDuration = () => {
    if (!startedAt || !completedAt) return null
    const ms = completedAt.getTime() - startedAt.getTime()
    const sec = Math.floor(ms / 1000)
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    const remSec = sec % 60
    return remSec > 0 ? `${min}min ${remSec}s` : `${min}min`
  }

  // Parse log lines for display
  const logLines = upgradeLogs
    ? upgradeLogs.split('\n').filter(l => l.trim()).slice(-80)
    : []

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { minHeight: '50vh' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-download-cloud-line" style={{ fontSize: 22 }} />
        {t('updates.nodeUpdateTitle')}
        <Chip
          size="small"
          label={nodeName}
          sx={{ ml: 1, fontWeight: 600 }}
        />
      </DialogTitle>

      <DialogContent dividers>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {steps.map((label, index) => (
            <Step key={label} completed={index < activeStep}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {/* Step 0: Configuration */}
        {activeStep === 0 && (
          <Stack spacing={2.5}>
            {/* SSH not configured warning */}
            {sshNotConfigured && (
              <Alert
                severity="error"
                icon={<i className="ri-terminal-box-line" style={{ fontSize: 20 }} />}
              >
                <Typography variant="body2" fontWeight={600}>
                  {t('updates.sshNotConfiguredTitle')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('updates.sshNotConfiguredDescription')}
                </Typography>
              </Alert>
            )}

            {/* Repository issues warning */}
            {repoIssues.length > 0 && (
              <Alert
                severity="error"
                icon={<i className="ri-archive-line" style={{ fontSize: 20 }} />}
              >
                <Typography variant="body2" fontWeight={600}>
                  {t('updates.repoIssuesTitle', { count: repoIssues.length })}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  {t('updates.repoIssuesDescription')}
                </Typography>
                {repoIssues.map((issue, i) => (
                  <Typography key={i} variant="caption" sx={{ display: 'block' }}>
                    &bull; {issue}
                  </Typography>
                ))}
              </Alert>
            )}

            {/* Package summary */}
            <Card variant="outlined">
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-download-cloud-line" style={{ fontSize: 18 }} />
                    <Typography variant="subtitle2" fontWeight={700}>
                      {pkgCount} {t('updates.packages').toLowerCase()}
                    </Typography>
                  </Box>
                  {nodeUpdate?.version && (
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>
                      {nodeUpdate.version}
                    </Typography>
                  )}
                </Box>
              </CardContent>
            </Card>

            {/* VM warning */}
            {vmCount > 0 && (
              <Alert
                severity="warning"
                icon={<i className="ri-computer-line" style={{ fontSize: 20 }} />}
              >
                <Typography variant="body2" fontWeight={600}>
                  {t('updates.vmsRunningOnNode', { count: vmCount })}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                  {t('updates.vmsShutdownHint')}
                </Typography>
              </Alert>
            )}

            {/* Options */}
            <Card variant="outlined">
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                  <i className="ri-settings-3-line" style={{ marginRight: 8, fontSize: 16 }} />
                  {t('updates.options')}
                </Typography>

                <Stack spacing={1} sx={{ mt: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={autoReboot}
                        onChange={(e) => setAutoReboot(e.target.checked)}
                        size="small"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body2">{t('updates.autoReboot')}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t('updates.autoRebootDescription')}
                        </Typography>
                      </Box>
                    }
                  />
                </Stack>
              </CardContent>
            </Card>

            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}

        {/* Step 1: Execution */}
        {activeStep === 1 && (
          <Stack spacing={2.5}>
            {/* Status */}
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" fontWeight={600}>
                    {upgradeStatus === 'REBOOTING' ? t('updates.rebooting') : t('updates.installingPackages')}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={upgradeStatus}
                  color="primary"
                  sx={{ height: 22, fontSize: 11 }}
                />
              </Box>
              <LinearProgress
                variant="indeterminate"
                sx={{ height: 6, borderRadius: 1 }}
              />
            </Box>

            {/* Logs */}
            {logLines.length > 0 && (
              <Card variant="outlined">
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 1 }}>
                    Logs
                  </Typography>
                  <Box
                    sx={{
                      maxHeight: 250,
                      overflow: 'auto',
                      bgcolor: 'background.default',
                      borderRadius: 1,
                      p: 1,
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 11,
                      lineHeight: 1.6,
                    }}
                  >
                    {logLines.map((line, i) => (
                      <Box key={i} sx={{ color: 'text.primary' }}>
                        {line}
                      </Box>
                    ))}
                    <div ref={logsEndRef} />
                  </Box>
                </CardContent>
              </Card>
            )}

            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}

        {/* Step 2: Completed */}
        {activeStep === 2 && (
          <Stack spacing={2.5}>
            <Alert
              severity={upgradeStatus === 'COMPLETED' ? 'success' : 'error'}
              icon={
                <i
                  className={upgradeStatus === 'COMPLETED' ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'}
                  style={{ fontSize: 22 }}
                />
              }
            >
              <Typography variant="body2" fontWeight={600}>
                {upgradeStatus === 'COMPLETED'
                  ? t('updates.updateCompletedSuccess')
                  : t('updates.updateFailed', { error: 'See logs for details' })
                }
              </Typography>
              {getDuration() && (
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  {t('updates.duration', { duration: getDuration() })}
                </Typography>
              )}
            </Alert>

            {/* Reboot status */}
            <Card variant="outlined">
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                  <i className="ri-server-line" style={{ marginRight: 8, fontSize: 16 }} />
                  {t('updates.resultTitle')}
                </Typography>
                <Stack spacing={1}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('updates.rebootLabel')}</Typography>
                    {rebootRequired ? (
                      <Chip size="small" label={t('updates.rebootRequiredNotDone')} color="warning" sx={{ height: 22, fontSize: 11 }} />
                    ) : (
                      <Chip size="small" label={t('updates.rebootNotRequired')} color="default" sx={{ height: 22, fontSize: 11 }} />
                    )}
                  </Box>

                  {rebootRequired && (
                    <Button
                      variant="outlined"
                      color="warning"
                      size="small"
                      startIcon={<i className="ri-restart-line" style={{ fontSize: 16 }} />}
                      onClick={rebootNode}
                      sx={{ alignSelf: 'flex-start' }}
                    >
                      {t('updates.rebootNow')}
                    </Button>
                  )}
                </Stack>
              </CardContent>
            </Card>

            {/* Logs in completed step */}
            {logLines.length > 0 && (
              <Card variant="outlined">
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 1 }}>
                    Logs
                  </Typography>
                  <Box
                    sx={{
                      maxHeight: 200,
                      overflow: 'auto',
                      bgcolor: 'background.default',
                      borderRadius: 1,
                      p: 1,
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 11,
                      lineHeight: 1.6,
                    }}
                  >
                    {logLines.map((line, i) => (
                      <Box key={i} sx={{ color: 'text.primary' }}>
                        {line}
                      </Box>
                    ))}
                  </Box>
                </CardContent>
              </Card>
            )}
          </Stack>
        )}

        {/* Loading overlay for initial start */}
        {loading && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4 }}>
            <CircularProgress size={40} />
            <Typography variant="body2" sx={{ mt: 2 }}>
              {t('updates.startingUpdate')}
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {activeStep === 0 && (
          <>
            <Button onClick={handleClose}>{t('common.cancel')}</Button>
            <Button
              variant="contained"
              color="warning"
              onClick={startUpdate}
              disabled={loading || pkgCount === 0 || repoIssues.length > 0 || repoChecking || sshNotConfigured}
              startIcon={loading ? <CircularProgress size={16} /> : <i className="ri-play-circle-line" style={{ fontSize: 18 }} />}
            >
              {t('updates.startUpdate')}
            </Button>
          </>
        )}

        {activeStep === 1 && upgradeStatus === 'RUNNING' && (
          <Button
            onClick={cancelUpdate}
            color="error"
            startIcon={<i className="ri-stop-circle-line" style={{ fontSize: 18 }} />}
          >
            {t('common.cancel')}
          </Button>
        )}

        {activeStep === 2 && (
          <Button onClick={handleClose} variant="contained">
            {t('common.close')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
