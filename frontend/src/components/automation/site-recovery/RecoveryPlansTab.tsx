'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Button, Card, CardContent, Chip, Collapse, Divider, Drawer,
  IconButton, Stack, Typography, alpha, useTheme
} from '@mui/material'

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
    not_ready: { color: 'default' }
  }

  const c = config[status] || config.not_ready

  return <Chip size='small' label={t(`siteRecovery.planStatus.${status}`)} color={c.color} />
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

const PlanCard = ({ plan, onClick, t }: { plan: RecoveryPlan; onClick: () => void; t: any }) => {
  const theme = useTheme()
  const daysSinceTest = daysSince(plan.last_test)
  const testWarning = daysSinceTest === null || daysSinceTest > 30

  return (
    <Card
      variant='outlined'
      onClick={onClick}
      sx={{
        borderRadius: 2, cursor: 'pointer', transition: 'all 0.2s ease',
        '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' }
      }}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
          <Box>
            <Typography variant='subtitle2' sx={{ fontWeight: 700, mb: 0.25 }}>{plan.name}</Typography>
            {plan.description && (
              <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block' }}>
                {plan.description}
              </Typography>
            )}
          </Box>
          <PlanStatusBadge status={plan.status} t={t} />
        </Box>

        {/* Cluster info */}
        <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
          {plan.source_cluster} → {plan.target_cluster}
        </Typography>

        {/* Tier summary */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <TierSummary vms={plan.vms} t={t} />
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant='caption' sx={{
              color: testWarning ? 'warning.main' : 'text.secondary',
              fontWeight: testWarning ? 600 : 400
            }}>
              {plan.last_test
                ? `${t('siteRecovery.plans.lastTest')}: ${daysSinceTest}d`
                : t('siteRecovery.plans.neverTested')}
            </Typography>
            {testWarning && (
              <Box sx={{ color: 'warning.main', fontSize: '0.7rem' }}>
                <i className='ri-alert-line' /> {t('siteRecovery.plans.testOverdue')}
              </Box>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
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
}

export default function RecoveryPlansTab({
  plans, loading, history, historyLoading,
  selectedPlanId, onSelectPlan,
  onTestFailover, onFailover, onFailback, onDeletePlan
}: RecoveryPlansTabProps) {
  const t = useTranslations()
  const theme = useTheme()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [expandedTiers, setExpandedTiers] = useState<Set<number>>(new Set([1, 2, 3]))

  const selected = useMemo(() => (plans || []).find(p => p.id === selectedPlanId), [plans, selectedPlanId])

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
        <Box sx={{ textAlign: 'center', py: 6, px: 3 }}>
          <Box sx={{ fontSize: '2.5rem', mb: 1, opacity: 0.3 }}><i className='ri-file-shield-2-line' /></Box>
          <Typography variant='subtitle1' sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('siteRecovery.plans.noPlans')}
          </Typography>
          <Typography variant='body2' sx={{ color: 'text.secondary' }}>
            {t('siteRecovery.plans.noPlansDesc')}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' } }}>
          {(plans || []).map(p => <PlanCard key={p.id} plan={p} onClick={() => openPlan(p.id)} t={t} />)}
        </Box>
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
                {selected.source_cluster} → {selected.target_cluster}
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
                    <Typography variant='overline' sx={{ color: 'text.secondary', fontWeight: 600, mb: 1, display: 'block' }}>
                      {t('siteRecovery.plans.executionHistory')}
                    </Typography>
                    <Stack spacing={0.5}>
                      {history.slice(0, 10).map(exec => (
                        <Box key={exec.id} sx={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          py: 0.75, px: 1, borderRadius: 1,
                          bgcolor: alpha(
                            exec.status === 'completed' ? theme.palette.success.main :
                            exec.status === 'failed' ? theme.palette.error.main :
                            theme.palette.info.main, 0.05
                          )
                        }}>
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
                  <Button
                    variant='outlined' size='small' fullWidth
                    startIcon={<i className='ri-test-tube-line' />}
                    onClick={() => onTestFailover(selected.id)}
                  >
                    {t('siteRecovery.plans.testFailover')}
                  </Button>
                  <Button
                    variant='contained' size='small' color='warning' fullWidth
                    startIcon={<i className='ri-shield-star-line' />}
                    onClick={() => onFailover(selected.id)}
                  >
                    {t('siteRecovery.plans.failover')}
                  </Button>
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
                </Stack>
              </Box>
            </>
          )}
        </Box>
      </Drawer>
    </Box>
  )
}
