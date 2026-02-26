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
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

interface NodeUpdateDialogProps {
  open: boolean
  onClose: () => void
  connectionId: string
  nodeName: string
  vmCount: number
  nodeUpdates: Record<string, { count: number; updates: any[]; version: string | null }>
  isCluster?: boolean
  hasCeph?: boolean
}

type UpgradeStatus = 'UNKNOWN' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REBOOTING'

const CEPH_MAINTENANCE_FLAGS = ['noout', 'norebalance', 'norecover']

export default function NodeUpdateDialog({
  open,
  onClose,
  connectionId,
  nodeName,
  vmCount,
  nodeUpdates,
  isCluster = false,
  hasCeph = false,
}: NodeUpdateDialogProps) {
  const t = useTranslations()

  // Steps depend on cluster mode
  const clusterMode = isCluster
  const steps = clusterMode
    ? [t('updates.stepPreflight'), t('updates.stepConfiguration'), t('updates.stepUpdate'), t('updates.stepPostActions'), t('updates.stepCompleted')]
    : [t('updates.stepConfiguration'), t('updates.stepUpdate'), t('updates.stepCompleted')]

  // Step mapping: logical step indices
  const STEP = clusterMode
    ? { PREFLIGHT: 0, CONFIG: 1, UPDATE: 2, POST: 3, COMPLETED: 4 }
    : { PREFLIGHT: -1, CONFIG: 0, UPDATE: 1, POST: -1, COMPLETED: 2 }

  const [activeStep, setActiveStep] = useState(0)

  // Config
  const [autoReboot, setAutoReboot] = useState(true)
  const [packagesExpanded, setPackagesExpanded] = useState(false)

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

  // Cluster pre-flight state
  const [maintenanceStatus, setMaintenanceStatus] = useState<string | null>(null)
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)
  const [enableMaintenance, setEnableMaintenance] = useState(true)
  const [cephFlags, setCephFlags] = useState<string[]>([])
  const [cephFlagsLoading, setCephFlagsLoading] = useState(false)
  const [setCephMaintenanceFlags, setSetCephMaintenanceFlags] = useState(true)
  const [preflightLoading, setPreflightLoading] = useState(false)

  // Cluster post-actions state
  const [postCephRemoving, setPostCephRemoving] = useState(false)
  const [postCephRemoved, setPostCephRemoved] = useState(false)
  const [postMaintenanceExiting, setPostMaintenanceExiting] = useState(false)
  const [postMaintenanceExited, setPostMaintenanceExited] = useState(false)
  const [didSetCephFlags, setDidSetCephFlags] = useState(false)
  const [didEnableMaintenance, setDidEnableMaintenance] = useState(false)

  const nodeUpdate = nodeUpdates?.[nodeName]
  const pkgCount = nodeUpdate?.count || 0

  const baseUrl = `/api/v1/connections/${connectionId}/nodes/${encodeURIComponent(nodeName)}/upgrade`
  const maintenanceUrl = `/api/v1/connections/${connectionId}/nodes/${encodeURIComponent(nodeName)}/maintenance`
  const cephFlagsUrl = `/api/v1/connections/${connectionId}/ceph/flags`

  const cephMaintenanceFlagsSet = CEPH_MAINTENANCE_FLAGS.every(f => cephFlags.includes(f))

  // Fetch pre-flight data when dialog opens in cluster mode
  useEffect(() => {
    if (!open || !connectionId || !nodeName || !clusterMode) return

    let cancelled = false
    setMaintenanceLoading(true)
    setCephFlagsLoading(hasCeph)

    // Fetch maintenance status
    fetch(maintenanceUrl)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return
        setMaintenanceStatus(json.data?.maintenance || null)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMaintenanceLoading(false) })

    // Fetch ceph flags if hasCeph
    if (hasCeph) {
      fetch(cephFlagsUrl)
        .then(res => res.json())
        .then(json => {
          if (cancelled) return
          setCephFlags(json.data?.flags || [])
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setCephFlagsLoading(false) })
    }

    return () => { cancelled = true }
  }, [open, connectionId, nodeName, clusterMode, hasCeph, maintenanceUrl, cephFlagsUrl])

  // Check SSH + repository configuration when dialog opens
  useEffect(() => {
    if (!open || !connectionId || !nodeName) return

    let cancelled = false
    setSshNotConfigured(false)
    setRepoChecking(true)
    setRepoIssues([])

    fetch(`/api/v1/connections/${connectionId}`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return
        if (!json.data?.sshEnabled) setSshNotConfigured(true)
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
        // Go to post-actions for cluster, completed for standalone
        setActiveStep(clusterMode ? STEP.POST : STEP.COMPLETED)

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
  }, [baseUrl, autoReboot, clusterMode, STEP.POST, STEP.COMPLETED])

  // Pre-flight: execute maintenance + ceph flags actions then go to config
  const executePreFlight = useCallback(async () => {
    setPreflightLoading(true)
    setError(null)

    try {
      // Enable maintenance mode if selected and not already active
      if (enableMaintenance && maintenanceStatus !== 'maintenance') {
        await fetch(maintenanceUrl, { method: 'POST' })
        setMaintenanceStatus('maintenance')
        setDidEnableMaintenance(true)
      }

      // Set Ceph maintenance flags if selected and hasCeph
      if (hasCeph && setCephMaintenanceFlags && !cephMaintenanceFlagsSet) {
        for (const flag of CEPH_MAINTENANCE_FLAGS) {
          if (!cephFlags.includes(flag)) {
            await fetch(cephFlagsUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ flag }),
            })
          }
        }
        setCephFlags(prev => [...new Set([...prev, ...CEPH_MAINTENANCE_FLAGS])])
        setDidSetCephFlags(true)
      }

      setActiveStep(STEP.CONFIG)
    } catch (e: any) {
      setError(e.message || 'Failed to prepare cluster')
    } finally {
      setPreflightLoading(false)
    }
  }, [enableMaintenance, maintenanceStatus, hasCeph, setCephMaintenanceFlags, cephMaintenanceFlagsSet, cephFlags, maintenanceUrl, cephFlagsUrl, STEP.CONFIG])

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
      setActiveStep(STEP.UPDATE)

      const interval = setInterval(pollStatus, 3000)
      pollingRef.current = interval

      setTimeout(pollStatus, 1500)
    } catch (e: any) {
      setError(e.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [baseUrl, autoReboot, pollStatus, STEP.UPDATE])

  const cancelUpdate = useCallback(async () => {
    try {
      await fetch(`/api/v1/connections/${connectionId}/nodes/${encodeURIComponent(nodeName)}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancel: true }),
      })
    } catch {}
  }, [connectionId, nodeName])

  // Post-actions: remove ceph flags
  const removeCephMaintenanceFlags = useCallback(async () => {
    setPostCephRemoving(true)
    try {
      for (const flag of CEPH_MAINTENANCE_FLAGS) {
        await fetch(cephFlagsUrl, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flag }),
        })
      }
      setCephFlags(prev => prev.filter(f => !CEPH_MAINTENANCE_FLAGS.includes(f)))
      setPostCephRemoved(true)
    } catch {}
    setPostCephRemoving(false)
  }, [cephFlagsUrl])

  // Post-actions: exit maintenance
  const exitMaintenance = useCallback(async () => {
    setPostMaintenanceExiting(true)
    try {
      await fetch(maintenanceUrl, { method: 'DELETE' })
      setMaintenanceStatus(null)
      setPostMaintenanceExited(true)
    } catch {}
    setPostMaintenanceExiting(false)
  }, [maintenanceUrl])

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
    setPackagesExpanded(false)
    setStartedAt(null)
    setCompletedAt(null)
    setMaintenanceStatus(null)
    setCephFlags([])
    setEnableMaintenance(true)
    setSetCephMaintenanceFlags(true)
    setPreflightLoading(false)
    setPostCephRemoving(false)
    setPostCephRemoved(false)
    setPostMaintenanceExiting(false)
    setPostMaintenanceExited(false)
    setDidSetCephFlags(false)
    setDidEnableMaintenance(false)
    onClose()
  }

  const rebootNode = useCallback(async () => {
    try {
      await fetch(`${baseUrl}/reboot`, { method: 'POST' })
      setRebootRequired(false)
    } catch {}
  }, [baseUrl])

  const getDuration = () => {
    if (!startedAt || !completedAt) return null
    const ms = completedAt.getTime() - startedAt.getTime()
    const sec = Math.floor(ms / 1000)
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    const remSec = sec % 60
    return remSec > 0 ? `${min}min ${remSec}s` : `${min}min`
  }

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

        {/* Step: Pre-flight (cluster only) */}
        {clusterMode && activeStep === STEP.PREFLIGHT && (
          <Stack spacing={2.5}>
            {/* Maintenance mode card */}
            <Card variant="outlined">
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                  <i className="ri-shield-check-line" style={{ marginRight: 8, fontSize: 16 }} />
                  {t('updates.maintenanceModeCard')}
                </Typography>

                {maintenanceLoading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                    <CircularProgress size={16} />
                    <Typography variant="caption" color="text.secondary">Loading...</Typography>
                  </Box>
                ) : maintenanceStatus === 'maintenance' ? (
                  <Alert severity="success" sx={{ mb: 1 }}>
                    <Typography variant="body2">{t('updates.maintenanceAlreadyEnabled')}</Typography>
                  </Alert>
                ) : (
                  <>
                    <Alert severity="warning" sx={{ mb: 1 }}>
                      <Typography variant="body2">{t('updates.maintenanceNotEnabled')}</Typography>
                    </Alert>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={enableMaintenance}
                          onChange={(e) => setEnableMaintenance(e.target.checked)}
                          size="small"
                        />
                      }
                      label={<Typography variant="body2">{t('updates.enableMaintenanceBefore')}</Typography>}
                    />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Ceph flags card (if hasCeph) */}
            {hasCeph && (
              <Card variant="outlined">
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    <i className="ri-database-2-line" style={{ marginRight: 8, fontSize: 16 }} />
                    {t('updates.cephFlagsCard')}
                  </Typography>

                  {cephFlagsLoading ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                      <CircularProgress size={16} />
                      <Typography variant="caption" color="text.secondary">Loading...</Typography>
                    </Box>
                  ) : cephMaintenanceFlagsSet ? (
                    <Alert severity="success" sx={{ mb: 1 }}>
                      <Typography variant="body2">{t('updates.cephFlagsAlreadySet')}</Typography>
                    </Alert>
                  ) : (
                    <>
                      <Alert severity="info" sx={{ mb: 1 }}>
                        <Typography variant="body2">{t('updates.cephFlagsNotSet')}</Typography>
                      </Alert>
                      {cephFlags.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                          {cephFlags.map(f => (
                            <Chip key={f} label={f} size="small" sx={{ fontFamily: 'monospace', fontSize: 11, height: 22 }} />
                          ))}
                        </Box>
                      )}
                      <FormControlLabel
                        control={
                          <Switch
                            checked={setCephMaintenanceFlags}
                            onChange={(e) => setSetCephMaintenanceFlags(e.target.checked)}
                            size="small"
                          />
                        }
                        label={<Typography variant="body2">{t('updates.setCephFlagsBefore')}</Typography>}
                      />
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* VM warning for cluster — migration, not shutdown */}
            {vmCount > 0 && (
              <Alert
                severity="info"
                icon={<i className="ri-swap-box-line" style={{ fontSize: 20 }} />}
              >
                <Typography variant="body2" fontWeight={600}>
                  {t('updates.vmsRunningOnNode', { count: vmCount })}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                  {t('updates.vmsMigrateHint')}
                </Typography>
              </Alert>
            )}

            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}

        {/* Step: Configuration */}
        {activeStep === STEP.CONFIG && (
          <Stack spacing={2.5}>
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

            <Card variant="outlined">
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-download-cloud-line" style={{ fontSize: 18 }} />
                    <Typography variant="subtitle2" fontWeight={700}>
                      {pkgCount} {t('updates.packages').toLowerCase()}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {nodeUpdate?.version && (
                      <Typography variant="caption" sx={{ opacity: 0.6 }}>
                        {nodeUpdate.version}
                      </Typography>
                    )}
                    {pkgCount > 0 && (
                      <IconButton size="small" onClick={() => setPackagesExpanded(p => !p)} sx={{ ml: 0.5 }}>
                        <i className={packagesExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 18 }} />
                      </IconButton>
                    )}
                  </Box>
                </Box>
                <Collapse in={packagesExpanded}>
                  {nodeUpdate?.updates && nodeUpdate.updates.length > 0 && (
                    <TableContainer sx={{ mt: 1.5, maxHeight: 250 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('updates.package')}</TableCell>
                            <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('updates.currentVersion')}</TableCell>
                            <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{t('updates.newVersion')}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {nodeUpdate.updates.map((pkg: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{pkg.Package}</TableCell>
                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 11, opacity: 0.6 }}>{pkg.OldVersion}</TableCell>
                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{pkg.Version}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Collapse>
              </CardContent>
            </Card>

            {/* VM warning (standalone only — for cluster it's in pre-flight) */}
            {!clusterMode && vmCount > 0 && (
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

        {/* Step: Execution */}
        {activeStep === STEP.UPDATE && (
          <Stack spacing={2.5}>
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

        {/* Step: Post-actions (cluster only) */}
        {clusterMode && activeStep === STEP.POST && (
          <Stack spacing={2.5}>
            {/* Update result */}
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

            {/* Ceph flags cleanup */}
            {didSetCephFlags && (
              <Card variant="outlined">
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    <i className="ri-database-2-line" style={{ marginRight: 8, fontSize: 16 }} />
                    {t('updates.cephFlagsCard')}
                  </Typography>
                  {postCephRemoved ? (
                    <Alert severity="success">
                      <Typography variant="body2">{t('updates.cephFlagsRemoved')}</Typography>
                    </Alert>
                  ) : (
                    <Button
                      variant="outlined"
                      color="warning"
                      size="small"
                      onClick={removeCephMaintenanceFlags}
                      disabled={postCephRemoving}
                      startIcon={postCephRemoving ? <CircularProgress size={14} /> : <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />}
                    >
                      {postCephRemoving ? t('updates.removingCephFlags') : t('updates.removeCephFlags')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Maintenance exit */}
            {didEnableMaintenance && (
              <Card variant="outlined">
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    <i className="ri-shield-check-line" style={{ marginRight: 8, fontSize: 16 }} />
                    {t('updates.maintenanceModeCard')}
                  </Typography>
                  {postMaintenanceExited ? (
                    <Alert severity="success">
                      <Typography variant="body2">{t('updates.maintenanceExited')}</Typography>
                    </Alert>
                  ) : (
                    <Button
                      variant="outlined"
                      color="warning"
                      size="small"
                      onClick={exitMaintenance}
                      disabled={postMaintenanceExiting}
                      startIcon={postMaintenanceExiting ? <CircularProgress size={14} /> : <i className="ri-logout-box-line" style={{ fontSize: 16 }} />}
                    >
                      {postMaintenanceExiting ? t('updates.exitingMaintenance') : t('updates.exitMaintenanceMode')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

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
          </Stack>
        )}

        {/* Step: Completed (standalone) or final step (cluster) */}
        {activeStep === STEP.COMPLETED && (
          <Stack spacing={2.5}>
            {/* For standalone: show result alert + reboot + logs */}
            {!clusterMode && (
              <>
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
              </>
            )}

            {/* For cluster: simple completion message */}
            {clusterMode && (
              <Alert severity="success" icon={<i className="ri-checkbox-circle-fill" style={{ fontSize: 22 }} />}>
                <Typography variant="body2" fontWeight={600}>
                  {t('updates.updateCompletedSuccess')}
                </Typography>
              </Alert>
            )}

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
        {/* Pre-flight actions (cluster only) */}
        {clusterMode && activeStep === STEP.PREFLIGHT && (
          <>
            <Button onClick={handleClose}>{t('common.cancel')}</Button>
            <Button
              variant="contained"
              onClick={executePreFlight}
              disabled={preflightLoading || maintenanceLoading || cephFlagsLoading}
              startIcon={preflightLoading ? <CircularProgress size={16} /> : <i className="ri-arrow-right-line" style={{ fontSize: 18 }} />}
            >
              {preflightLoading ? t('updates.preparingCluster') : t('common.next')}
            </Button>
          </>
        )}

        {/* Configuration actions */}
        {activeStep === STEP.CONFIG && (
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

        {/* Update running */}
        {activeStep === STEP.UPDATE && upgradeStatus === 'RUNNING' && (
          <Button
            onClick={cancelUpdate}
            color="error"
            startIcon={<i className="ri-stop-circle-line" style={{ fontSize: 18 }} />}
          >
            {t('common.cancel')}
          </Button>
        )}

        {/* Post-actions (cluster) */}
        {clusterMode && activeStep === STEP.POST && (
          <Button
            onClick={() => setActiveStep(STEP.COMPLETED)}
            variant="contained"
          >
            {t('updates.finish')}
          </Button>
        )}

        {/* Completed */}
        {activeStep === STEP.COMPLETED && (
          <Button onClick={handleClose} variant="contained">
            {t('common.close')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
