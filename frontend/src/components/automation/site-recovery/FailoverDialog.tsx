'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, LinearProgress, MenuItem, Select, Stack, TextField, Tooltip, Typography
} from '@mui/material'

import { ScreenshotPreviewDialog, useExecutionScreenshots, type ScreenshotMeta } from './ExecutionScreenshots'

import type { RecoveryPlan, RecoveryExecution, RecoveryVMResult, PlanRestorePoints } from '@/lib/orchestrator/site-recovery.types'

// ── Main Component ─────────────────────────────────────────────────────

interface FailoverDialogProps {
  open: boolean
  onClose: () => void
  plan: RecoveryPlan | null
  type: 'test' | 'failover' | 'failback'
  onConfirm: (options?: { restorePoints?: Record<number, string> }) => void
  onCleanup?: () => void
  cleanupLoading?: boolean
  cleanupResult?: { vms_stopped: number; disks_rolled: number; jobs_resumed: number; errors: string[] } | null
  execution: RecoveryExecution | null
  errorMessage?: string | null
  targetConnId?: string
  connections?: { id: string; name: string }[]
  vmNameMap?: Record<number, string>
  restorePoints?: PlanRestorePoints | null
  restorePointsLoading?: boolean
  restorePointsError?: boolean
}

export default function FailoverDialog({ open, onClose, plan, type, onConfirm, onCleanup, cleanupLoading, cleanupResult, execution, errorMessage, targetConnId, connections, vmNameMap, restorePoints, restorePointsLoading, restorePointsError }: FailoverDialogProps) {
  const t = useTranslations()
  const [confirmText, setConfirmText] = useState('')
  const [selectedPoints, setSelectedPoints] = useState<Record<number, string>>({})
  const screenshots = useExecutionScreenshots(execution && type === 'test' ? execution.id : null)
  const [screenshotPreview, setScreenshotPreview] = useState<ScreenshotMeta | null>(null)
  const isDestructive = type === 'failover' || type === 'failback'
  const isExecuting = !!execution && execution.status === 'running'
  const [stabilizeRemainingSeconds, setStabilizeRemainingSeconds] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      setConfirmText('')
      setSelectedPoints({})
    }
  }, [open])

  // Live countdown for the 'stabilizing' phase, ticking every second while
  // it's active — so the ~45-60s post-boot wait shows a deadline instead of
  // an indefinite spinner.
  useEffect(() => {
    if (execution?.phase !== 'stabilizing' || !execution.phase_ends_at) {
      setStabilizeRemainingSeconds(null)
      return
    }
    const endsAt = new Date(execution.phase_ends_at).getTime()
    const tick = () => setStabilizeRemainingSeconds(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [execution?.phase, execution?.phase_ends_at])

  if (!plan) return null

  const confirmRequired = isDestructive ? plan.name : null
  // A test failover started before this page load has no in-memory
  // `execution` yet — the rehydration fetch on open is still in flight or
  // failed. Block a second test-failover attempt until it resolves.
  const testActiveUnresolved = type === 'test' && !!plan.active_test_execution_id && !execution
  const canConfirm = (!isDestructive || confirmText === confirmRequired) && !testActiveUnresolved

  const typeConfig = {
    test: {
      title: t('siteRecovery.failover.testTitle'),
      description: t('siteRecovery.failover.testDescription'),
      color: 'info' as const,
      icon: 'ri-test-tube-line',
      severity: 'info' as const
    },
    failover: {
      title: t('siteRecovery.failover.failoverTitle'),
      description: t('siteRecovery.failover.failoverDescription'),
      color: 'warning' as const,
      icon: 'ri-shield-star-line',
      severity: 'warning' as const
    },
    failback: {
      title: t('siteRecovery.failover.failbackTitle'),
      description: t('siteRecovery.failover.failbackDescription'),
      color: 'warning' as const,
      icon: 'ri-arrow-go-back-line',
      severity: 'warning' as const
    }
  }

  const config = typeConfig[type]

  return (
    <Dialog open={open} onClose={isExecuting ? undefined : onClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className={config.icon} />
        {config.title}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Alert severity={config.severity}>{config.description}</Alert>

          {restorePointsError && !execution && type !== 'failback' && (
            <Alert severity='info'>{t('siteRecovery.failover.restorePointsLoadFailed')}</Alert>
          )}

          {testActiveUnresolved && (
            <Alert severity='warning'>
              {t('siteRecovery.failover.testActiveBanner', {
                date: plan.last_test ? new Date(plan.last_test).toLocaleString() : ''
              })}
            </Alert>
          )}

          {type === 'test' && (
            <Chip
              size='small'
              icon={<i className='ri-wifi-off-line' />}
              label={t('siteRecovery.failover.networkIsolated')}
              color='info'
              variant='outlined'
              sx={{ mt: -0.5 }}
            />
          )}

          {/* Plan Summary — VM list with per-VM status + noVNC console button */}
          <Box sx={{ p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            {/* VM list with per-VM status + noVNC console button */}
            {(() => {
              const resultsByVMID: Record<number, RecoveryVMResult> = {}
              for (const r of (execution?.vm_results || [])) resultsByVMID[r.vm_id] = r
              const sortedVMs = [...plan.vms].sort((a, b) => (a.boot_order || 0) - (b.boot_order || 0))
              const showRestoreSelector = !execution && type !== 'failback'
              return (
                <Stack spacing={0.5} sx={{ maxHeight: 260, overflow: 'auto' }}>
                  {sortedVMs.map(vm => {
                    const res = resultsByVMID[vm.vm_id]
                    const statusIcon = res
                      ? res.status === 'completed' ? { icon: 'ri-check-line', color: 'success.main' }
                        : res.status === 'failed' ? { icon: 'ri-close-line', color: 'error.main' }
                        : res.status === 'running' ? { icon: 'ri-loader-4-line', color: 'primary.main' }
                        : { icon: 'ri-time-line', color: 'text.disabled' }
                      : null
                    const canConsole = type === 'test'
                      && targetConnId
                      && res
                      && res.target_node
                      && res.target_vmid != null
                      && (res.status === 'running' || res.status === 'completed')
                    return (
                      <Box key={vm.vm_id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, px: 0.75, borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' } }}>
                        {statusIcon && (
                          <Box sx={{ width: 16, textAlign: 'center', color: statusIcon.color, fontSize: 14, display: 'inline-flex', justifyContent: 'center' }}>
                            <i className={statusIcon.icon} style={{ animation: statusIcon.icon === 'ri-loader-4-line' ? 'spin 1.5s linear infinite' : 'none' }} />
                            <Box sx={{ '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } } }} />
                          </Box>
                        )}
                        <Chip
                          size='small'
                          label={`T${vm.tier}`}
                          color={vm.tier === 1 ? 'error' : vm.tier === 2 ? 'warning' : 'default'}
                          variant='outlined'
                          sx={{ height: 18, fontSize: '0.6rem', minWidth: 32 }}
                        />
                        <i className='ri-computer-line' style={{ fontSize: 14, opacity: 0.65 }} />
                        <Typography variant='body2' sx={{ fontWeight: 500, fontSize: '0.8rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {vmNameMap?.[vm.vm_id] || (vm.vm_name && !vm.vm_name.startsWith('VM ') ? vm.vm_name : `VM ${vm.vm_id}`)}
                        </Typography>
                        {showRestoreSelector && !restorePointsError && (
                          restorePointsLoading ? (
                            <CircularProgress size={14} />
                          ) : (() => {
                            const vmRestore = restorePoints?.vms.find(v => v.vm_id === vm.vm_id)
                            if (!vmRestore || vmRestore.error || vmRestore.restore_points.length === 0) {
                              return (
                                <Typography variant='caption' sx={{ color: 'text.disabled', fontSize: '0.65rem', minWidth: 170, textAlign: 'right' }}>
                                  {t('siteRecovery.failover.restorePointsNone')}
                                </Typography>
                              )
                            }
                            return (
                              <>
                                <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                                  {t('siteRecovery.failover.restorePointChoose')}
                                </Typography>
                                <Select
                                  size='small'
                                  displayEmpty
                                  value={selectedPoints[vm.vm_id] || ''}
                                  onChange={e => {
                                    const val = e.target.value
                                    setSelectedPoints(prev => {
                                      const next = { ...prev }
                                      if (val) next[vm.vm_id] = val
                                      else delete next[vm.vm_id]
                                      return next
                                    })
                                  }}
                                  sx={{ minWidth: 170, fontSize: '0.75rem' }}
                                >
                                  <MenuItem value=''>{t('siteRecovery.failover.restorePointLatest')}</MenuItem>
                                  {vmRestore.restore_points.map(rp => (
                                    <MenuItem key={rp.snapshot} value={rp.snapshot}>
                                      <i className='ri-camera-line' style={{ fontSize: 13, marginRight: 6, opacity: 0.7 }} />
                                      {new Date(rp.created_iso).toLocaleString()}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </>
                            )
                          })()
                        )}
                        {canConsole && (
                          <Tooltip title={t('siteRecovery.failover.openConsole')} arrow>
                            <IconButton
                              size='small'
                              onClick={(e) => {
                                e.stopPropagation()
                                window.open(
                                  `/novnc/console.html?connId=${encodeURIComponent(targetConnId!)}&type=qemu&node=${encodeURIComponent(res!.target_node!)}&vmid=${res!.target_vmid}`,
                                  `console-dr-${res!.target_vmid}`,
                                  'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no'
                                )
                              }}
                              sx={{ color: 'primary.main', p: 0.5 }}
                            >
                              <i className='ri-terminal-box-line' style={{ fontSize: 14 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                        {type === 'test' && (() => {
                          const shot = screenshots.find(s => s.vm_id === vm.vm_id)
                          if (!shot) return null
                          return (
                            <Tooltip title={t('siteRecovery.screenshots.view')}>
                              <IconButton size='small' onClick={() => setScreenshotPreview(shot)} sx={{ color: 'text.secondary' }}>
                                <i className='ri-camera-line' />
                              </IconButton>
                            </Tooltip>
                          )
                        })()}
                      </Box>
                    )
                  })}
                </Stack>
              )
            })()}
          </Box>

          {type === 'failover' && Object.keys(selectedPoints).length > 0 && (
            <Alert severity='warning'>{t('siteRecovery.failover.restorePointRebaseWarning')}</Alert>
          )}

          {/* Confirm field for destructive operations */}
          {isDestructive && !isExecuting && !execution && (
            <Box>
              <Typography variant='body2' sx={{ mb: 1 }}>
                {t('siteRecovery.failover.typeToConfirm', { name: plan.name })}
              </Typography>
              <TextField
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={plan.name}
                size='small'
                fullWidth
                autoComplete='off'
              />
            </Box>
          )}

          {/* Cleanup result */}
          {cleanupResult && (() => {
            const errs = cleanupResult.errors || []
            return (
              <Alert severity={errs.length > 0 ? 'warning' : 'success'}>
                <Typography variant='body2' sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t('siteRecovery.failover.cleanupDone')}
                </Typography>
                <Typography variant='caption' component='div'>
                  {cleanupResult.vms_stopped > 0 && <>{cleanupResult.vms_stopped} VM(s) {t('siteRecovery.failover.stopped')}<br /></>}
                  {cleanupResult.disks_rolled > 0 && <>{cleanupResult.disks_rolled} {t('siteRecovery.failover.disksRolledBack')}<br /></>}
                  {cleanupResult.jobs_resumed > 0 && <>{cleanupResult.jobs_resumed} {t('siteRecovery.failover.jobsResumed')}</>}
                </Typography>
                {errs.length > 0 && errs.map((err: string, i: number) => (
                  <Typography key={i} variant='caption' sx={{ color: 'error.main', display: 'block', mt: 0.5 }}>{err}</Typography>
                ))}
              </Alert>
            )
          })()}

          {/* Failover completion summary */}
          {execution && execution.status === 'completed' && type === 'failover' && (() => {
            const results = execution.vm_results || []
            const total = results.length
            const okCount = results.filter(r => r.status === 'completed').length
            const allOk = total > 0 && okCount === total
            return (
              <Alert severity={allOk ? 'success' : 'warning'}>
                <Typography variant='body2' sx={{ fontWeight: 600, mb: 0.5 }}>
                  {t('siteRecovery.failover.completeTitle')}
                </Typography>
                <Typography variant='caption' component='div'>
                  {okCount}/{total} {t('siteRecovery.failover.completeVMs')}
                </Typography>
                <Typography variant='caption' component='div'>
                  {t('siteRecovery.failover.completeLocked')}
                </Typography>
              </Alert>
            )
          })()}

          {/* Execution progress */}
          {isExecuting && execution && (
            <Box>
              <Typography variant='subtitle2' sx={{ mb: 1.5 }}>
                {t('siteRecovery.failover.inProgress')}
              </Typography>
              <Stack spacing={1}>
                {(execution.vm_results || []).map((vm: RecoveryVMResult) => (
                  <Box key={vm.vm_id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ width: 20, textAlign: 'center' }}>
                      {vm.status === 'completed' && <i className='ri-check-line' style={{ color: 'var(--mui-palette-success-main)' }} />}
                      {vm.status === 'failed' && <i className='ri-close-line' style={{ color: 'var(--mui-palette-error-main)' }} />}
                      {vm.status === 'running' && <i className='ri-loader-4-line' style={{ color: 'var(--mui-palette-primary-main)' }} />}
                      {vm.status === 'pending' && <i className='ri-time-line' style={{ color: 'var(--mui-palette-text-disabled)' }} />}
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                        <Typography variant='body2' sx={{ fontWeight: 500, fontSize: '0.8rem' }}>{vm.vm_name}</Typography>
                        <Typography variant='caption' sx={{ color: 'text.secondary' }}>{vm.progress_percent}%</Typography>
                      </Box>
                      <LinearProgress
                        variant={vm.status === 'running' ? 'indeterminate' : 'determinate'}
                        value={vm.progress_percent}
                        color={vm.status === 'failed' ? 'error' : vm.status === 'completed' ? 'success' : 'primary'}
                        sx={{ height: 3, borderRadius: 1 }}
                      />
                      {vm.error && (
                        <Typography variant='caption' sx={{ color: 'error.main', fontSize: '0.65rem' }}>{vm.error}</Typography>
                      )}
                      {!vm.error && vm.status === 'running' && vm.step && t.has(`siteRecovery.failover.step.${vm.step}`) && (
                        <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <i className='ri-loader-4-line' style={{ fontSize: 11, animation: 'spin 1.5s linear infinite' }} />
                          {t(`siteRecovery.failover.step.${vm.step}`)}
                        </Typography>
                      )}
                    </Box>
                    {type === 'test' && targetConnId && vm.target_node && vm.target_vmid != null &&
                     (vm.status === 'running' || vm.status === 'completed') && (
                      <Tooltip title={t('siteRecovery.failover.openConsole')}>
                        <IconButton
                          size='small'
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open(
                              `/novnc/console.html?connId=${encodeURIComponent(targetConnId)}&type=qemu&node=${encodeURIComponent(vm.target_node!)}&vmid=${vm.target_vmid}`,
                              `console-dr-${vm.target_vmid}`,
                              'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no'
                            )
                          }}
                          sx={{ color: 'primary.main' }}
                        >
                          <i className='ri-terminal-box-line' />
                        </IconButton>
                      </Tooltip>
                    )}
                    {(() => {
                      const shot = screenshots.find(s => s.vm_id === vm.vm_id)
                      if (!shot) return null
                      return (
                        <Tooltip title={t('siteRecovery.screenshots.view')}>
                          <IconButton
                            size='small'
                            onClick={() => setScreenshotPreview(shot)}
                            sx={{ color: 'text.secondary' }}
                          >
                            <i className='ri-camera-line' />
                          </IconButton>
                        </Tooltip>
                      )
                    })()}
                  </Box>
                ))}
              </Stack>
              {type === 'test' && (() => {
                const allTerminal = (execution.vm_results || []).length > 0
                  && (execution.vm_results || []).every((vm: RecoveryVMResult) => vm.status === 'completed' || vm.status === 'failed')
                const steps = [
                  {
                    key: 'boot',
                    label: t('siteRecovery.screenshots.stepBoot'),
                    state: (execution.phase === 'stabilizing' || execution.phase === 'capturing' || allTerminal) ? 'done' : 'active'
                  },
                  {
                    key: 'stabilize',
                    label: execution.phase === 'stabilizing' && stabilizeRemainingSeconds != null
                      ? `${t('siteRecovery.screenshots.stepStabilize')} (${stabilizeRemainingSeconds} s)`
                      : t('siteRecovery.screenshots.stepStabilize'),
                    state: execution.phase === 'capturing' ? 'done' : execution.phase === 'stabilizing' ? 'active' : 'pending'
                  },
                  {
                    key: 'capture',
                    label: t('siteRecovery.screenshots.stepCapture'),
                    state: execution.phase === 'capturing' ? 'active' : 'pending'
                  }
                ] as const
                return (
                  <Stack spacing={0.75} sx={{ mt: 1.5 }}>
                    {steps.map(step => {
                      const stepIcon = step.state === 'done' ? { icon: 'ri-check-line', color: 'success.main' }
                        : step.state === 'active' ? { icon: 'ri-loader-4-line', color: 'primary.main' }
                        : { icon: 'ri-time-line', color: 'text.disabled' }
                      return (
                        <Box key={step.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 16, textAlign: 'center', color: stepIcon.color, fontSize: 14, display: 'inline-flex', justifyContent: 'center' }}>
                            <i className={stepIcon.icon} style={{ animation: stepIcon.icon === 'ri-loader-4-line' ? 'spin 1.5s linear infinite' : 'none' }} />
                            <Box sx={{ '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } } }} />
                          </Box>
                          <Typography variant='caption' sx={{ color: 'text.secondary' }}>{step.label}</Typography>
                        </Box>
                      )
                    })}
                  </Stack>
                )
              })()}
            </Box>
          )}
        </Stack>
      </DialogContent>
      {errorMessage && <Alert severity='error' sx={{ mx: 3 }}>{errorMessage}</Alert>}
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {!execution && (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              variant='contained'
              color={config.color}
              onClick={() => onConfirm(Object.keys(selectedPoints).length ? { restorePoints: selectedPoints } : undefined)}
              disabled={!canConfirm}
              startIcon={<i className={config.icon} />}
            >
              {config.title}
            </Button>
          </>
        )}
        {execution && execution.status !== 'running' && (
          <>
            {type === 'test' && onCleanup && !cleanupResult && (
              <Button
                variant='outlined'
                color='warning'
                onClick={onCleanup}
                disabled={cleanupLoading}
                startIcon={cleanupLoading
                  ? <i className='ri-loader-4-line' />
                  : <i className='ri-delete-back-2-line' />
                }
              >
                {t('siteRecovery.failover.cleanup')}
              </Button>
            )}
            <Button onClick={onClose}>{t('common.close')}</Button>
          </>
        )}
      </DialogActions>
      {execution && (
        <ScreenshotPreviewDialog
          executionId={execution.id}
          shot={screenshotPreview}
          label={screenshotPreview ? (vmNameMap?.[screenshotPreview.vm_id] || `VM ${screenshotPreview.vm_id}`) : ''}
          onClose={() => setScreenshotPreview(null)}
        />
      )}
    </Dialog>
  )
}
