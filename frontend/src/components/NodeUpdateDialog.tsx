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

interface RollingUpdate {
  id: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  total_nodes: number
  completed_nodes: number
  current_node: string
  node_statuses: Array<{
    node_name: string
    status: string
    started_at?: string
    completed_at?: string
    error?: string
    reboot_required: boolean
    did_reboot: boolean
    version_before?: string
    version_after?: string
  }>
  logs: Array<{
    timestamp: string
    level: string
    node?: string
    message: string
  }>
  error?: string
  started_at?: string
  completed_at?: string
}

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
  const [shutdownLocalVms, setShutdownLocalVms] = useState(false)

  // Execution
  const [loading, setLoading] = useState(false)
  const [rollingUpdate, setRollingUpdate] = useState<RollingUpdate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const logsEndRef = useRef<HTMLDivElement | null>(null)

  // Repository check
  const [repoIssues, setRepoIssues] = useState<string[]>([])
  const [repoChecking, setRepoChecking] = useState(false)

  const nodeUpdate = nodeUpdates?.[nodeName]
  const pkgCount = nodeUpdate?.count || 0

  // Check repository configuration when dialog opens
  useEffect(() => {
    if (!open || !connectionId || !nodeName) return

    let cancelled = false
    setRepoChecking(true)
    setRepoIssues([])

    fetch(`/api/v1/connections/${connectionId}/nodes/${encodeURIComponent(nodeName)}/apt/repositories`)
      .then(res => res.json())
      .then(json => {
        if (cancelled || !json.data?.standard_repos) return

        // PVE returns status as Option<bool>: null=not configured, true=enabled, false=disabled
        const repos = json.data.standard_repos as Array<{ handle: string; status: boolean | null; name: string }>
        const status: Record<string, boolean | null> = {}
        for (const r of repos) {
          status[r.handle] = r.status
        }

        const issues: string[] = []

        // PVE enterprise without no-subscription
        if (status['enterprise'] === true && status['no-subscription'] !== true) {
          issues.push('PVE Enterprise repository is enabled without a no-subscription alternative. apt update will fail without a valid PVE subscription.')
        }

        // Ceph enterprise without no-subscription (e.g. ceph-squid-enterprise / ceph-squid-no-subscription)
        for (const [handle, s] of Object.entries(status)) {
          if (s === true && handle.endsWith('-enterprise') && handle !== 'enterprise') {
            const base = handle.replace(/-enterprise$/, '')
            if (status[`${base}-no-subscription`] !== true) {
              issues.push(`${base} enterprise repository is enabled without a no-subscription alternative.`)
            }
          }
        }

        // Repo errors from PVE
        if (json.data.errors?.length) {
          for (const e of json.data.errors) {
            issues.push(`Repository error: ${e.message}`)
          }
        }

        setRepoIssues(issues)
      })
      .catch(() => {
        // Ignore - repo check is best-effort
      })
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
  }, [rollingUpdate?.logs?.length])

  const startUpdate = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const config = {
        node_order: [nodeName],
        exclude_nodes: [],
        migrate_non_ha_vms: false,
        shutdown_local_vms: shutdownLocalVms,
        max_concurrent_migrations: 1,
        migration_timeout: 600,
        auto_reboot: autoReboot,
        reboot_timeout: 300,
        require_manual_approval: false,
        min_healthy_nodes: 0,
        abort_on_failure: true,
        set_ceph_noout: false,
        wait_ceph_healthy: false,
        restore_vm_placement: false,
        notify_on_complete: true,
        notify_on_error: true,
      }

      const res = await fetch('/api/v1/orchestrator/rolling-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: connectionId, config }),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || 'Failed to start update')
      }

      setRollingUpdate(json.data)
      setActiveStep(1)

      // Poll for status
      const interval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/v1/orchestrator/rolling-updates/${json.data.id}`)
          const statusJson = await statusRes.json()

          if (statusRes.ok && statusJson.data) {
            setRollingUpdate(statusJson.data)

            if (['completed', 'failed', 'cancelled'].includes(statusJson.data.status)) {
              clearInterval(interval)
              pollingRef.current = null
              setActiveStep(2)
            }
          }
        } catch {
          // ignore polling errors
        }
      }, 3000)

      pollingRef.current = interval
    } catch (e: any) {
      setError(e.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [connectionId, nodeName, autoReboot, shutdownLocalVms])

  const cancelUpdate = useCallback(async () => {
    if (!rollingUpdate) return
    try {
      await fetch(`/api/v1/orchestrator/rolling-updates/${rollingUpdate.id}/cancel`, { method: 'POST' })
    } catch {
      // ignore
    }
  }, [rollingUpdate])

  const handleClose = () => {
    if (rollingUpdate && ['running', 'paused'].includes(rollingUpdate.status)) {
      if (!window.confirm(t('updates.confirmCloseWhileRunning'))) {
        return
      }
    }

    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    setActiveStep(0)
    setRollingUpdate(null)
    setError(null)
    setAutoReboot(true)
    setShutdownLocalVms(false)
    onClose()
  }

  // Compute duration string
  const getDuration = () => {
    if (!rollingUpdate?.started_at || !rollingUpdate?.completed_at) return null
    const ms = new Date(rollingUpdate.completed_at).getTime() - new Date(rollingUpdate.started_at).getTime()
    const sec = Math.floor(ms / 1000)
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    const remSec = sec % 60
    return remSec > 0 ? `${min}min ${remSec}s` : `${min}min`
  }

  const nodeStatus = rollingUpdate?.node_statuses?.[0]

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

                  {vmCount > 0 && (
                    <FormControlLabel
                      control={
                        <Switch
                          checked={shutdownLocalVms}
                          onChange={(e) => setShutdownLocalVms(e.target.checked)}
                          size="small"
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2">{t('updates.shutdownVms')}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t('updates.shutdownVmsDescription')}
                          </Typography>
                        </Box>
                      }
                    />
                  )}
                </Stack>
              </CardContent>
            </Card>

            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}

        {/* Step 1: Execution */}
        {activeStep === 1 && rollingUpdate && (
          <Stack spacing={2.5}>
            {/* Status */}
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" fontWeight={600}>
                    {nodeStatus?.status === 'updating' ? t('updates.installingPackages') :
                     nodeStatus?.status === 'rebooting' ? t('updates.rebooting') :
                     nodeStatus?.status === 'migrating_vms' ? t('updates.managingVms') :
                     t('updates.updateInProgress')}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={rollingUpdate.status}
                  color={rollingUpdate.status === 'running' ? 'primary' : 'warning'}
                  sx={{ height: 22, fontSize: 11 }}
                />
              </Box>
              <LinearProgress
                variant={nodeStatus?.status === 'rebooting' ? 'indeterminate' : 'indeterminate'}
                sx={{ height: 6, borderRadius: 1 }}
              />
            </Box>

            {/* Logs */}
            {rollingUpdate.logs && rollingUpdate.logs.length > 0 && (
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
                    {rollingUpdate.logs.slice(-50).map((log, i) => (
                      <Box
                        key={i}
                        sx={{
                          color: log.level === 'error' ? 'error.main' :
                                 log.level === 'warning' ? 'warning.main' :
                                 'text.primary',
                        }}
                      >
                        <Typography component="span" sx={{ opacity: 0.4, fontSize: 'inherit', fontFamily: 'inherit' }}>
                          [{new Date(log.timestamp).toLocaleTimeString()}]
                        </Typography>
                        {' '}{log.message}
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
        {activeStep === 2 && rollingUpdate && (
          <Stack spacing={2.5}>
            <Alert
              severity={rollingUpdate.status === 'completed' ? 'success' : 'error'}
              icon={
                <i
                  className={rollingUpdate.status === 'completed' ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'}
                  style={{ fontSize: 22 }}
                />
              }
            >
              <Typography variant="body2" fontWeight={600}>
                {rollingUpdate.status === 'completed'
                  ? t('updates.updateCompletedSuccess')
                  : rollingUpdate.status === 'cancelled'
                    ? t('updates.updateCancelled')
                    : t('updates.updateFailed', { error: rollingUpdate.error || t('updates.unknownError') })
                }
              </Typography>
              {getDuration() && (
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  {t('updates.duration', { duration: getDuration() })}
                </Typography>
              )}
            </Alert>

            {/* Node result */}
            {nodeStatus && (
              <Card variant="outlined">
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    <i className="ri-server-line" style={{ marginRight: 8, fontSize: 16 }} />
                    {t('updates.resultTitle')}
                  </Typography>
                  <Stack spacing={1}>
                    {/* Version transition */}
                    {nodeStatus.version_before && nodeStatus.version_after && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('updates.versionLabel')}</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                          {nodeStatus.version_before}
                        </Typography>
                        <i className="ri-arrow-right-line" style={{ fontSize: 14, opacity: 0.5 }} />
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12, color: 'success.main', fontWeight: 600 }}>
                          {nodeStatus.version_after}
                        </Typography>
                      </Box>
                    )}

                    {/* Reboot status */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('updates.rebootLabel')}</Typography>
                      {nodeStatus.did_reboot ? (
                        <Chip size="small" label={t('updates.rebooted')} color="info" icon={<i className="ri-restart-line" style={{ fontSize: 14 }} />} sx={{ height: 22, fontSize: 11 }} />
                      ) : nodeStatus.reboot_required ? (
                        <Chip size="small" label={t('updates.rebootRequiredNotDone')} color="warning" sx={{ height: 22, fontSize: 11 }} />
                      ) : (
                        <Chip size="small" label={t('updates.rebootNotRequired')} color="default" sx={{ height: 22, fontSize: 11 }} />
                      )}
                    </Box>

                    {/* Error */}
                    {nodeStatus.error && (
                      <Alert severity="error" sx={{ mt: 1 }}>
                        {nodeStatus.error}
                      </Alert>
                    )}
                  </Stack>
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
              disabled={loading || pkgCount === 0 || repoIssues.length > 0 || repoChecking}
              startIcon={loading ? <CircularProgress size={16} /> : <i className="ri-play-circle-line" style={{ fontSize: 18 }} />}
            >
              {t('updates.startUpdate')}
            </Button>
          </>
        )}

        {activeStep === 1 && rollingUpdate && ['running', 'paused'].includes(rollingUpdate.status) && (
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
