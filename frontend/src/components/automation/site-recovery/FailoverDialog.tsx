'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, LinearProgress, Stack, TextField, Tooltip, Typography
} from '@mui/material'

import type { RecoveryPlan, RecoveryExecution, RecoveryVMResult } from '@/lib/orchestrator/site-recovery.types'

// ── Main Component ─────────────────────────────────────────────────────

interface FailoverDialogProps {
  open: boolean
  onClose: () => void
  plan: RecoveryPlan | null
  type: 'test' | 'failover' | 'failback'
  onConfirm: () => void
  onCleanup?: () => void
  cleanupLoading?: boolean
  cleanupResult?: { vms_stopped: number; disks_rolled: number; jobs_resumed: number; errors: string[] } | null
  execution: RecoveryExecution | null
  targetConnId?: string
}

export default function FailoverDialog({ open, onClose, plan, type, onConfirm, onCleanup, cleanupLoading, cleanupResult, execution, targetConnId }: FailoverDialogProps) {
  const t = useTranslations()
  const [confirmText, setConfirmText] = useState('')
  const isDestructive = type === 'failover' || type === 'failback'
  const isExecuting = !!execution && execution.status === 'running'

  useEffect(() => {
    if (!open) setConfirmText('')
  }, [open])

  if (!plan) return null

  const tierCounts = [1, 2, 3].map(tier => plan.vms.filter(v => v.tier === tier).length)
  const confirmRequired = isDestructive ? plan.name : null
  const canConfirm = !isDestructive || confirmText === confirmRequired

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

          {/* Plan Summary */}
          <Box sx={{ p: 2, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant='subtitle2' sx={{ fontWeight: 600, mb: 1 }}>{plan.name}</Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              {plan.source_cluster} → {plan.target_cluster}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              {[1, 2, 3].map((tier, i) => tierCounts[i] > 0 && (
                <Box key={tier} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Chip
                    size='small'
                    label={`Tier ${tier}`}
                    color={tier === 1 ? 'error' : tier === 2 ? 'warning' : 'default'}
                    variant='outlined'
                    sx={{ height: 20, fontSize: '0.65rem' }}
                  />
                  <Typography variant='caption' sx={{ fontWeight: 600 }}>
                    {tierCounts[i]} VM{tierCounts[i] > 1 ? 's' : ''}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Confirm field for destructive operations */}
          {isDestructive && !isExecuting && (
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
          {cleanupResult && (
            <Alert severity={cleanupResult.errors.length > 0 ? 'warning' : 'success'}>
              <Typography variant='body2' sx={{ fontWeight: 600, mb: 0.5 }}>
                {t('siteRecovery.failover.cleanupDone')}
              </Typography>
              <Typography variant='caption' component='div'>
                {cleanupResult.vms_stopped > 0 && <>{cleanupResult.vms_stopped} VM(s) {t('siteRecovery.failover.stopped')}<br /></>}
                {cleanupResult.disks_rolled > 0 && <>{cleanupResult.disks_rolled} {t('siteRecovery.failover.disksRolledBack')}<br /></>}
                {cleanupResult.jobs_resumed > 0 && <>{cleanupResult.jobs_resumed} {t('siteRecovery.failover.jobsResumed')}</>}
              </Typography>
              {cleanupResult.errors.length > 0 && cleanupResult.errors.map((err, i) => (
                <Typography key={i} variant='caption' sx={{ color: 'error.main', display: 'block', mt: 0.5 }}>{err}</Typography>
              ))}
            </Alert>
          )}

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
                    </Box>
                    {type === 'test' && targetConnId && vm.target_node && vm.target_vmid &&
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
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {!isExecuting && (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button
              variant='contained'
              color={config.color}
              onClick={onConfirm}
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
    </Dialog>
  )
}
