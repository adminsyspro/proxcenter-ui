'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Button, Card, CardContent, Chip, Collapse, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Divider, Drawer,
  IconButton, Stack, Tooltip, Typography, alpha, useTheme
} from '@mui/material'

import EmptyState from '@/components/EmptyState'

import ExecutionScreenshots from './ExecutionScreenshots'

import type { RecoveryPlan, RecoveryExecution, RecoveryPlanStatus } from '@/lib/orchestrator/site-recovery.types'

// ── Helpers ────────────────────────────────────────────────────────────

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null

  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

// ── Sub-components ─────────────────────────────────────────────────────

const PlanStatusBadge = ({ status, t }: { status: RecoveryPlanStatus; t: any }) => {
  const config: Record<RecoveryPlanStatus, { color: 'success' | 'warning' | 'info' | 'error' | 'default' }> = {
    ready: { color: 'success' },
    degraded: { color: 'warning' },
    executing: { color: 'info' },
    failed: { color: 'error' },
    not_ready: { color: 'default' },
    failed_over: { color: 'error' },
    failing_back: { color: 'info' }
  }

  const c = config[status] || config.not_ready
  const label = status === 'failing_back' ? t('siteRecovery.plans.statusFailingBack') : t(`siteRecovery.planStatus.${status}`)

  return <Chip size='small' label={label} color={c.color} />
}

const TierSummary = ({ vms, t }: { vms: RecoveryPlan['vms']; t: any }) => {
  const tiers = [1, 2, 3] as const
  const counts = tiers.map(tier => vms.filter(v => v.tier === tier).length)

  return (
    <Box sx={{ display: 'flex', gap: 1.5 }}>
      {tiers.map((tier, i) => counts[i] > 0 && (
        <Box key={tier} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Chip
            size='small'
            label={`T${tier}`}
            sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700 }}
            color={tier === 1 ? 'error' : tier === 2 ? 'warning' : 'default'}
            variant='outlined'
          />
          <Typography variant='caption' sx={{ fontWeight: 600 }}>{counts[i]}</Typography>
        </Box>
      ))}
    </Box>
  )
}

const PlanRow = ({ plan, onClick, t, connName }: { plan: RecoveryPlan; onClick: () => void; t: any; connName: (id: string) => string }) => {
  const daysSinceTest = daysSince(plan.last_test)
  const testWarning = daysSinceTest === null || daysSinceTest > 30

  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.25,
        cursor: 'pointer', transition: 'all 0.15s ease', borderRadius: 1,
        '&:hover': { bgcolor: 'action.hover' }
      }}
    >
      {/* Name + description */}
      <Box sx={{ flex: '1 1 30%', minWidth: 0 }}>
        <Typography variant='body2' sx={{ fontWeight: 600, lineHeight: 1.3 }} noWrap>{plan.name}</Typography>
        {plan.description && (
          <Typography variant='caption' sx={{ color: 'text.secondary', lineHeight: 1.2 }} noWrap>{plan.description}</Typography>
        )}
      </Box>

      {/* Source → Destination */}
      <Box sx={{ flex: '1 1 30%', minWidth: 0 }}>
        <Typography variant='caption' sx={{ color: 'text.secondary' }} noWrap>
          {connName(plan.source_cluster)} → {connName(plan.target_cluster)}
        </Typography>
      </Box>

      {/* Tier summary */}
      <Box sx={{ flex: '0 0 auto' }}>
        <TierSummary vms={plan.vms} t={t} />
      </Box>

      {/* Last test */}
      <Box sx={{ flex: '0 0 auto', textAlign: 'right', minWidth: 90 }}>
        <Typography variant='caption' sx={{
          color: testWarning ? 'warning.main' : 'text.secondary',
          fontWeight: testWarning ? 600 : 400,
          fontSize: '0.7rem'
        }}>
          {plan.last_test
            ? `${daysSinceTest}d`
            : t('siteRecovery.plans.neverTested')}
        </Typography>
        {testWarning && (
          <Box sx={{ color: 'warning.main', fontSize: '0.6rem', lineHeight: 1.2 }}>
            <i className='ri-alert-line' />
          </Box>
        )}
      </Box>

      {/* Active test: while the plan is executing the test is still running;
          once it finishes, active_test_execution_id alone means cleanup is due */}
      {plan.active_test_execution_id && (
        <Box sx={{ flex: '0 0 auto' }}>
          {plan.status === 'executing' ? (
            <Chip size='small' color='info' variant='outlined'
              icon={<i className='ri-test-tube-line' />}
              label={t('siteRecovery.plans.testRunning')}
              sx={{ height: 22, fontSize: '0.65rem' }} />
          ) : (
            <Chip size='small' color='warning' variant='outlined'
              icon={<i className='ri-eraser-line' />}
              label={t('siteRecovery.plans.cleanupPending')}
              sx={{ height: 22, fontSize: '0.65rem' }} />
          )}
        </Box>
      )}

      {/* Status */}
      <Box sx={{ flex: '0 0 auto' }}>
        <PlanStatusBadge status={plan.status} t={t} />
      </Box>
    </Box>
  )
}

// ── Main Component ─────────────────────────────────────────────────────

interface RecoveryPlansTabProps {
  plans: RecoveryPlan[]
  loading: boolean
  history: RecoveryExecution[]
  historyLoading: boolean
  selectedPlanId: string | null
  onSelectPlan: (id: string | null) => void
  onTestFailover: (id: string) => void
  onFailover: (id: string) => void
  onFailback: (id: string) => void
  onDeletePlan: (id: string) => void
  onCleanupTest: (id: string) => void
  onHistoryCleared?: () => void
  connections?: Array<{ id: string; name: string }>
}

export default function RecoveryPlansTab({
  plans, loading, history, historyLoading,
  selectedPlanId, onSelectPlan,
  onTestFailover, onFailover, onFailback, onDeletePlan, onCleanupTest, onHistoryCleared,
  connections
}: RecoveryPlansTabProps) {
  const t = useTranslations()
  const theme = useTheme()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [expandedTiers, setExpandedTiers] = useState<Set<number>>(new Set([1, 2, 3]))
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)

  const selected = useMemo(() => (plans || []).find(p => p.id === selectedPlanId), [plans, selectedPlanId])

  const connName = useMemo(() => {
    const map = new Map((connections || []).map(c => [c.id, c.name]))
    return (id: string) => map.get(id) || id
  }, [connections])

  const openPlan = (id: string) => {
    onSelectPlan(id)
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    onSelectPlan(null)
  }

  const toggleTier = (tier: number) => {
    setExpandedTiers(prev => {
      const next = new Set(prev)

      if (next.has(tier)) next.delete(tier)
      else next.add(tier)

      return next
    })
  }

  const handleClearHistory = async () => {
    setConfirmClearHistory(false)

    if (!selected) return

    await fetch(`/api/v1/orchestrator/replication/plans/${selected.id}/history`, { method: 'DELETE' })
    onHistoryCleared?.()
  }

  if (loading) {
    return (
      <Stack spacing={2}>
        {[1, 2].map(i => (
          <Card key={i} variant='outlined' sx={{ borderRadius: 2, height: 120 }}>
            <CardContent><Typography color='text.secondary'>{t('common.loading')}</Typography></CardContent>
          </Card>
        ))}
      </Stack>
    )
  }

  return (
    <Box>
      {/* Plan Cards Grid */}
      {(plans || []).length === 0 ? (
        <EmptyState
          icon=''
          title={t('siteRecovery.plans.noPlans')}
          description={t('siteRecovery.plans.noPlansDesc')}
          size='large'
        />
      ) : (
        <Card variant='outlined' sx={{ borderRadius: 2 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant='caption' sx={{ flex: '1 1 30%', fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.65rem' }}>
              {t('siteRecovery.plans.planName')}
            </Typography>
            <Typography variant='caption' sx={{ flex: '1 1 30%', fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.65rem' }}>
              {t('siteRecovery.plans.sourceDestination')}
            </Typography>
            <Typography variant='caption' sx={{ flex: '0 0 auto', fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.65rem' }}>
              VMs
            </Typography>
            <Typography variant='caption' sx={{ flex: '0 0 auto', fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.65rem', minWidth: 90, textAlign: 'right' }}>
              {t('siteRecovery.plans.lastTest')}
            </Typography>
            <Typography variant='caption' sx={{ flex: '0 0 auto', fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.65rem' }}>
              {t('common.status')}
            </Typography>
          </Box>
          {/* Rows */}
          {(plans || []).map((p, i) => (
            <Box key={p.id}>
              {i > 0 && <Divider />}
              <PlanRow plan={p} onClick={() => openPlan(p.id)} t={t} connName={connName} />
            </Box>
          ))}
        </Card>
      )}

      {/* Detail Drawer */}
      <Drawer anchor='right' open={drawerOpen} onClose={closeDrawer} PaperProps={{ sx: { width: { xs: '100%', sm: 420 } } }}>
        <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
          {!selected ? (
            <Alert severity='info'>{t('siteRecovery.plans.selectPlan')}</Alert>
          ) : (
            <>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Box>
                  <Typography variant='h6' sx={{ fontWeight: 700, mb: 0.25 }}>{selected.name}</Typography>
                  {selected.description && (
                    <Typography variant='caption' sx={{ color: 'text.secondary' }}>{selected.description}</Typography>
                  )}
                </Box>
                <IconButton onClick={closeDrawer} size='small'><i className='ri-close-line' /></IconButton>
              </Box>

              <PlanStatusBadge status={selected.status} t={t} />

              <Typography variant='caption' sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
                {connName(selected.source_cluster)} → {connName(selected.target_cluster)}
              </Typography>

              <Box sx={{ flex: 1, overflow: 'auto', mt: 2 }}>
                {/* VMs grouped by tier */}
                {([1, 2, 3] as const).map(tier => {
                  const tierVms = selected.vms.filter(v => v.tier === tier)

                  if (tierVms.length === 0) return null

                  const tierLabels = { 1: t('siteRecovery.plans.tierCritical'), 2: t('siteRecovery.plans.tierImportant'), 3: t('siteRecovery.plans.tierStandard') }
                  const tierColors = { 1: 'error', 2: 'warning', 3: 'default' } as const

                  return (
                    <Box key={tier} sx={{ mb: 1.5 }}>
                      <Box
                        onClick={() => toggleTier(tier)}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', py: 0.75 }}
                      >
                        <i className={expandedTiers.has(tier) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
                        <Chip size='small' label={`Tier ${tier}`} color={tierColors[tier]} variant='outlined' sx={{ height: 20, fontSize: '0.65rem' }} />
                        <Typography variant='caption' sx={{ fontWeight: 600 }}>
                          {tierLabels[tier]} ({tierVms.length})
                        </Typography>
                      </Box>
                      <Collapse in={expandedTiers.has(tier)}>
                        <Stack spacing={0.5} sx={{ pl: 4, pt: 0.5 }}>
                          {tierVms.sort((a, b) => a.boot_order - b.boot_order).map(vm => (
                            <Box key={vm.vm_id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant='caption' sx={{ color: 'text.secondary', width: 20, textAlign: 'center' }}>
                                  #{vm.boot_order}
                                </Typography>
                                <Typography variant='body2' sx={{ fontWeight: 500 }}>{vm.vm_name}</Typography>
                              </Box>
                              <Typography variant='caption' sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                                VM {vm.vm_id}
                              </Typography>
                            </Box>
                          ))}
                        </Stack>
                      </Collapse>
                    </Box>
                  )
                })}

                {/* Execution History */}
                {history && history.length > 0 && (
                  <>
                    <Divider sx={{ my: 2 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant='overline' sx={{ color: 'text.secondary', fontWeight: 600, display: 'block' }}>
                        {t('siteRecovery.plans.executionHistory')}
                      </Typography>
                      <IconButton
                        size='small'
                        color='inherit'
                        aria-label={t('siteRecovery.plans.clearHistory')}
                        onClick={() => setConfirmClearHistory(true)}
                        sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                      >
                        <i className='ri-delete-bin-line' />
                      </IconButton>
                    </Box>
                    <Stack spacing={0.5}>
                      {history.slice(0, 10).map(exec => (
                        <Box key={exec.id} sx={{
                          py: 0.75, px: 1, borderRadius: 1,
                          bgcolor: alpha(
                            exec.status === 'completed' ? theme.palette.success.main :
                            exec.status === 'failed' ? theme.palette.error.main :
                            theme.palette.info.main, 0.05
                          )
                        }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Box>
                              <Typography variant='body2' sx={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'capitalize' }}>
                                {exec.type}
                              </Typography>
                              <Typography variant='caption' sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                                {new Date(exec.started_at).toLocaleString()}
                              </Typography>
                            </Box>
                            <Chip
                              size='small'
                              label={exec.status}
                              color={exec.status === 'completed' ? 'success' : exec.status === 'failed' ? 'error' : 'info'}
                              sx={{ height: 20, fontSize: '0.65rem' }}
                            />
                          </Box>
                          {exec.type === 'test' && (
                            <ExecutionScreenshots
                              executionId={exec.id}
                              vmNameMap={Object.fromEntries((selected.vms || []).map(v => [v.vm_id, v.vm_name]))}
                            />
                          )}
                        </Box>
                      ))}
                    </Stack>
                  </>
                )}

                <Divider sx={{ my: 2 }} />

                {/* Actions */}
                <Typography variant='overline' sx={{ color: 'text.secondary', fontWeight: 600, mb: 1.5, display: 'block' }}>
                  {t('siteRecovery.plans.actions')}
                </Typography>
                <Stack spacing={1}>
                  {selected.status === 'failing_back' ? (
                    <>
                      <Button
                        variant='contained' size='small' color='info' fullWidth
                        startIcon={<i className='ri-arrow-go-back-line' />}
                        onClick={() => onFailback(selected.id)}
                      >
                        {t('siteRecovery.plans.openFailback')}
                      </Button>
                      <Tooltip title={t('siteRecovery.plans.failingBackTooltip')} arrow>
                        <span style={{ display: 'block' }}>
                          <Button
                            variant='outlined' size='small' color='error' fullWidth
                            startIcon={<i className='ri-delete-bin-line' />}
                            disabled
                          >
                            {t('common.delete')}
                          </Button>
                        </span>
                      </Tooltip>
                    </>
                  ) : (
                    <>
                      {/* Cleanup only once the test finished — the orchestrator
                          refuses it while the plan is still executing */}
                      {selected.active_test_execution_id && selected.status !== 'executing' && (
                        <Button
                          variant='contained' size='small' color='warning' fullWidth
                          startIcon={<i className='ri-eraser-line' />}
                          onClick={() => onCleanupTest(selected.id)}
                        >
                          {t('siteRecovery.failover.cleanup')}
                        </Button>
                      )}
                      <Tooltip
                        title={selected.status === 'failed_over' ? t('siteRecovery.plans.failedOverTooltip') : t('siteRecovery.plans.testActiveTooltip')}
                        disableHoverListener={!(selected.active_test_execution_id || selected.status === 'executing' || selected.status === 'failed_over')}
                        arrow
                      >
                        <span style={{ display: 'block' }}>
                          <Button
                            variant='outlined' size='small' fullWidth
                            startIcon={<i className='ri-test-tube-line' />}
                            onClick={() => onTestFailover(selected.id)}
                            disabled={!!selected.active_test_execution_id || selected.status === 'executing' || selected.status === 'failed_over'}
                          >
                            {t('siteRecovery.plans.testFailover')}
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip
                        title={t('siteRecovery.plans.failedOverTooltip')}
                        disableHoverListener={selected.status !== 'failed_over'}
                        arrow
                      >
                        <span style={{ display: 'block' }}>
                          <Button
                            variant='contained' size='small' color='warning' fullWidth
                            startIcon={<i className='ri-shield-star-line' />}
                            onClick={() => onFailover(selected.id)}
                            disabled={selected.status === 'failed_over'}
                          >
                            {t('siteRecovery.plans.failover')}
                          </Button>
                        </span>
                      </Tooltip>
                      <Button
                        variant='outlined' size='small' fullWidth
                        startIcon={<i className='ri-arrow-go-back-line' />}
                        onClick={() => onFailback(selected.id)}
                      >
                        {t('siteRecovery.plans.failback')}
                      </Button>
                      <Button
                        variant='outlined' size='small' color='error' fullWidth
                        startIcon={<i className='ri-delete-bin-line' />}
                        onClick={() => { onDeletePlan(selected.id); closeDrawer() }}
                      >
                        {t('common.delete')}
                      </Button>
                    </>
                  )}
                </Stack>
              </Box>
            </>
          )}
        </Box>
      </Drawer>

      {/* Clear history confirmation */}
      <Dialog open={confirmClearHistory} onClose={() => setConfirmClearHistory(false)} maxWidth='sm' fullWidth>
        <DialogTitle>{t('siteRecovery.plans.clearHistory')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('siteRecovery.plans.clearHistoryConfirm')}</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmClearHistory(false)}>{t('common.cancel')}</Button>
          <Button variant='contained' color='error' onClick={handleClearHistory}>
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
