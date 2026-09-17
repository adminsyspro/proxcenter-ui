'use client'

import { Fragment, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Box, Button, Card, CardContent, Chip, Collapse, Dialog, DialogActions, DialogContent,
  DialogContentText, DialogTitle, Divider,
  IconButton, Stack, Tooltip, Typography, alpha, useTheme
} from '@mui/material'

import EmptyState from '@/components/EmptyState'
import AppDialogTitle from '@/components/ui/AppDialogTitle'

import ExecutionScreenshots from './ExecutionScreenshots'

import EngineGlyph from './EngineGlyph'
import type { RecoveryPlan, RecoveryExecution, RecoveryPlanStatus, ReplicationJob, StorageEngine } from '@/lib/orchestrator/site-recovery.types'

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

// planEngines lists the storage engines behind a plan, Ceph first, from the jobs
// its VMs reference; a plan whose jobs are unknown is shown as Ceph, the legacy default.
export function planEngines(plan: RecoveryPlan, jobs: ReplicationJob[] = []): StorageEngine[] {
  const byId = new Map(jobs.map(job => [job.id, job.storage_engine || 'rbd'] as const))
  const engines = new Set<StorageEngine>(plan.vms.map(vm => byId.get(vm.replication_job_id) || 'rbd'))
  return (['rbd', 'zfs'] as StorageEngine[]).filter(engine => engines.has(engine))
}

// PlanEngineGlyphs draws the glyph(s) of the engines behind a plan, on each end of its route.
const PlanEngineGlyphs = ({ engines, size = 14 }: { engines: StorageEngine[]; size?: number }) => (
  <Box sx={{ display: 'inline-flex', gap: 0.5, flexShrink: 0 }}>
    {engines.map(engine => <EngineGlyph key={engine} engine={engine} size={size} />)}
  </Box>
)

// PlanIcon opens a row with the same pictogram as the Recovery Plans tab; the status has its own chip.
const PlanIcon = () => <i className='ri-file-shield-2-line' style={{ fontSize: 18, opacity: 0.8, flexShrink: 0 }} />

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

// The list is one CSS grid: the header and every row are subgrids of it, so
// a column is as wide as its widest cell across ALL rows and the cells line
// up whatever a single row carries (the "cleanup pending" chip used to push
// the source and destination of its own row to the left). Columns: pictogram,
// name, source and destination, tiers, last test, active-test chip, status.
const planGridColumns = 'auto minmax(0, 3fr) minmax(0, 3fr) auto minmax(90px, auto) auto auto'
const planGridRow = { display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: 'subgrid', alignItems: 'center' } as const

const PlanRow = ({ plan, engines, onClick, t, connName }: { plan: RecoveryPlan; engines: StorageEngine[]; onClick: () => void; t: any; connName: (id: string) => string }) => {
  const daysSinceTest = daysSince(plan.last_test)
  const testWarning = daysSinceTest === null || daysSinceTest > 30

  return (
    <Box
      onClick={onClick}
      sx={{
        ...planGridRow, px: 2, py: 1.25,
        cursor: 'pointer', transition: 'all 0.15s ease', borderRadius: 1,
        '&:hover': { bgcolor: 'action.hover' }
      }}
    >
      {/* Plan pictogram, same as the tab */}
      <PlanIcon />

      {/* Name + description */}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant='body2' sx={{ fontWeight: 600, lineHeight: 1.3 }} noWrap>{plan.name}</Typography>
        {plan.description && (
          <Typography variant='caption' sx={{ color: 'text.secondary', lineHeight: 1.2 }} noWrap>{plan.description}</Typography>
        )}
      </Box>

      {/* Source → Destination, each end carrying the engine glyph(s) */}
      <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75, whiteSpace: 'nowrap' }}>
        <PlanEngineGlyphs engines={engines} />
        <Typography variant='caption' sx={{ color: 'text.secondary' }} noWrap>{connName(plan.source_cluster)}</Typography>
        <Typography variant='caption' sx={{ color: 'text.disabled' }}>→</Typography>
        <PlanEngineGlyphs engines={engines} />
        <Typography variant='caption' sx={{ color: 'text.secondary' }} noWrap>{connName(plan.target_cluster)}</Typography>
      </Box>

      {/* Tier summary */}
      <Box>
        <TierSummary vms={plan.vms} t={t} />
      </Box>

      {/* Last test */}
      <Box sx={{ textAlign: 'right' }}>
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
          once it finishes, active_test_execution_id alone means cleanup is due.
          The cell is always there so the status column stays put. */}
      <Box>
        {plan.active_test_execution_id && (
          plan.status === 'executing' ? (
            <Chip size='small' color='info' variant='outlined'
              icon={<i className='ri-test-tube-line' />}
              label={t('siteRecovery.plans.testRunning')}
              sx={{ height: 22, fontSize: '0.65rem' }} />
          ) : (
            <Chip size='small' color='warning' variant='outlined'
              icon={<i className='ri-eraser-line' />}
              label={t('siteRecovery.plans.cleanupPending')}
              sx={{ height: 22, fontSize: '0.65rem' }} />
          )
        )}
      </Box>

      {/* Status */}
      <Box>
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
  onEditPlan: (id: string) => void
  onDeletePlan: (id: string) => void
  onCleanupTest: (id: string) => void
  onHistoryCleared?: () => void
  connections?: Array<{ id: string; name: string }>
  jobs?: ReplicationJob[]
}

export default function RecoveryPlansTab({
  plans, loading, history, historyLoading,
  selectedPlanId, onSelectPlan,
  onTestFailover, onFailover, onFailback, onEditPlan, onDeletePlan, onCleanupTest, onHistoryCleared,
  connections, jobs = []
}: RecoveryPlansTabProps) {
  const t = useTranslations()
  const theme = useTheme()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [expandedTiers, setExpandedTiers] = useState<Set<number>>(new Set([1, 2, 3]))
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)

  const selected = useMemo(() => (plans || []).find(p => p.id === selectedPlanId), [plans, selectedPlanId])

  // The other plans listing a guest of the selected one, each with the shared
  // vmids. A guest is the same guest when it sits on the same source cluster:
  // a vmid alone is only unique per cluster. Legitimate (a broad plan plus a
  // narrow rehearsal one), so it is shown, not forbidden.
  const sharedWith = useMemo(() => {
    if (!selected) return []

    const ids = new Set((selected.vms || []).map(v => v.vm_id))

    return (plans || [])
      .filter(p => p.id !== selected.id && p.source_cluster === selected.source_cluster)
      .map(p => ({ name: p.name, vmIds: (p.vms || []).filter(v => ids.has(v.vm_id)).map(v => v.vm_id) }))
      .filter(p => p.vmIds.length > 0)
  }, [plans, selected])

  const otherPlansByGuest = useMemo(() => {
    const m = new Map<number, string[]>()

    for (const p of sharedWith) for (const id of p.vmIds) m.set(id, [...(m.get(id) || []), p.name])

    return m
  }, [sharedWith])

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
        <Card variant='outlined' sx={{ borderRadius: 2, display: 'grid', gridTemplateColumns: planGridColumns, columnGap: 2 }}>
          {/* Header: one cell per column, the pictogram and chip cells stay empty */}
          <Box sx={{ ...planGridRow, px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box />
            <Typography variant='caption' sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.65rem' }}>
              {t('siteRecovery.plans.planName')}
            </Typography>
            <Typography variant='caption' sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.65rem' }}>
              {t('siteRecovery.plans.sourceDestination')}
            </Typography>
            <Typography variant='caption' sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.65rem' }}>
              VMs
            </Typography>
            <Typography variant='caption' sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.65rem', textAlign: 'right' }}>
              {t('siteRecovery.plans.lastTest')}
            </Typography>
            <Box />
            <Typography variant='caption' sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.65rem' }}>
              {t('common.status')}
            </Typography>
          </Box>
          {/* Rows */}
          {(plans || []).map((p, i) => (
            <Fragment key={p.id}>
              {i > 0 && <Divider sx={{ gridColumn: '1 / -1' }} />}
              <PlanRow plan={p} engines={planEngines(p, jobs)} onClick={() => openPlan(p.id)} t={t} connName={connName} />
            </Fragment>
          ))}
        </Card>
      )}

      {/* Plan details. A centred dialog rather than the 420 px side drawer this
          replaces: the guest list, the execution history and its boot
          screenshots each want width, and stacking them in one narrow column
          made the panel an endless scroll where nothing could be read (ui#958
          feedback). Same shell as the replication job details. Below sm the
          Paper takes the whole screen, where a centred box would only lose its
          margins. */}
      <Dialog
        open={drawerOpen}
        onClose={closeDrawer}
        fullWidth
        maxWidth='lg'
        PaperProps={{
          sx: {
            m: { xs: 0, sm: 4 },
            width: { xs: '100%', sm: 'calc(100% - 64px)' },
            maxWidth: { xs: '100%', sm: 1180 },
            height: { xs: '100%', sm: 'auto' },
            maxHeight: { sm: '90vh' },
            borderRadius: { xs: 0, sm: 1 }
          }
        }}
      >
        {!selected ? (
          <Box sx={{ p: 2.5 }}>
            <Alert severity='info'>{t('siteRecovery.plans.selectPlan')}</Alert>
          </Box>
        ) : (
          <>
            {/* The shared dialog header, as everywhere else in the app. The
                description rides with the name on one line rather than taking
                a second: it is a subtitle, not a paragraph. */}
            <AppDialogTitle icon={<PlanIcon />} onClose={closeDrawer}>
              <Box component='span' sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75, minWidth: 0, maxWidth: '100%' }}>
                <Box component='span' sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selected.name}
                </Box>
                {selected.description && (
                  <Box component='span' sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'text.secondary', fontWeight: 400 }}>
                    - {selected.description}
                  </Box>
                )}
              </Box>
            </AppDialogTitle>

            <Box sx={{ px: 2.5, pb: 1, pt: 0.5, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              {/* Route and status on one strip: the status chip used to be
                  stretched edge to edge by the drawer's flex column, which
                  turned a chip into a banner. */}
              <Box sx={{ p: 2, borderRadius: 1, bgcolor: 'action.hover', mb: sharedWith.length > 0 ? 0.75 : 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <PlanEngineGlyphs engines={planEngines(selected, jobs)} size={16} />
                <Typography variant='body2' sx={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {connName(selected.source_cluster)}
                </Typography>
                <Box aria-hidden component='i' className='ri-arrow-right-line' sx={{ color: 'text.disabled' }} />
                <Typography variant='body2' sx={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {connName(selected.target_cluster)}
                </Typography>
                <Box sx={{ ml: 'auto' }}>
                  <PlanStatusBadge status={selected.status} t={t} />
                </Box>
              </Box>

              {/* Guests this plan shares with other plans, as "name (vmid, vmid)". */}
              {sharedWith.length > 0 && (
                <Typography variant='caption' color='text.secondary' sx={{ display: 'block', px: 0.5, mb: 2 }}>
                  {t('siteRecovery.plans.sharesGuestsWith', { plans: sharedWith.map(p => `${p.name} (${p.vmIds.join(', ')})`).join(', ') })}
                </Typography>
              )}

              {/* Two columns from md up: the guests on the left, the history on
                  the right. Each scrolls with the body, which keeps the action
                  footer in view however long the history gets. */}
              <Box sx={{
                flex: 1, minHeight: 0, overflow: 'auto',
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
                columnGap: 3, rowGap: 2, alignContent: 'start'
              }}>
                <Box sx={{ minWidth: 0 }}>
                  {/* minHeight matches the history header, whose icon button
                      makes its row taller: without it the two column titles
                      sit on different baselines. */}
                  <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 34, mb: 0.5 }}>
                    <Typography variant='overline' sx={{ color: 'text.secondary', fontWeight: 600, display: 'block' }}>
                      {t('siteRecovery.dashboard.protectedVms')}
                    </Typography>
                  </Box>
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
                          <Stack spacing={0.5} sx={{ pl: 4, pt: 0.5, maxWidth: 420 }}>
                            {tierVms.sort((a, b) => a.boot_order - b.boot_order).map(vm => (
                              <Box key={vm.vm_id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, py: 0.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                                  <Typography variant='caption' sx={{ color: 'text.secondary', width: 20, textAlign: 'center', flexShrink: 0 }}>
                                    #{vm.boot_order}
                                  </Typography>
                                  <Typography variant='body2' sx={{ fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {vm.vm_name}
                                  </Typography>
                                  {otherPlansByGuest.has(vm.vm_id) && (
                                    <Chip
                                      size='small'
                                      variant='outlined'
                                      label={t('siteRecovery.plans.alsoInPlan', { plan: (otherPlansByGuest.get(vm.vm_id) || []).join(', ') })}
                                      sx={{ height: 20, fontSize: '0.65rem', flexShrink: 0 }}
                                    />
                                  )}
                                </Box>
                                <Typography variant='caption' sx={{ color: 'text.secondary', flexShrink: 0 }}>
                                  VM {vm.vm_id}
                                </Typography>
                              </Box>
                            ))}
                          </Stack>
                        </Collapse>
                      </Box>
                    )
                  })}
                </Box>

                {/* Execution History */}
                {history && history.length > 0 && (
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 34, mb: 0.5 }}>
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
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                            <Box sx={{ minWidth: 0 }}>
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
                              sx={{ height: 20, fontSize: '0.65rem', flexShrink: 0 }}
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
                  </Box>
                )}
              </Box>
            </Box>

            {/* Actions keep their labels: unlike the job dialog's four icons,
                these are the point of the screen and two of them are
                destructive enough that a bare pictogram would be a trap. */}
            <DialogActions sx={{ px: 2.5, pb: 2.5, pt: 1, gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {selected.status === 'failing_back' ? (
                <>
                  <Tooltip title={t('siteRecovery.plans.failingBackTooltip')} arrow>
                    <span>
                      <Button
                        variant='outlined' size='small' color='error'
                        startIcon={<i className='ri-delete-bin-line' />}
                        disabled
                      >
                        {t('common.delete')}
                      </Button>
                    </span>
                  </Tooltip>
                  <Button
                    variant='contained' size='small' color='info'
                    startIcon={<i className='ri-arrow-go-back-line' />}
                    onClick={() => { onFailback(selected.id); closeDrawer() }}
                  >
                    {t('siteRecovery.plans.openFailback')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant='outlined' size='small' color='error'
                    startIcon={<i className='ri-delete-bin-line' />}
                    onClick={() => { onDeletePlan(selected.id); closeDrawer() }}
                  >
                    {t('common.delete')}
                  </Button>
                  <Tooltip
                    title={t('siteRecovery.plans.editPlanBusyTooltip')}
                    disableHoverListener={selected.status !== 'executing'}
                    arrow
                  >
                    <span>
                      <Button
                        variant='outlined' size='small'
                        startIcon={<i className='ri-pencil-line' />}
                        onClick={() => { onEditPlan(selected.id); closeDrawer() }}
                        disabled={selected.status === 'executing'}
                      >
                        {t('siteRecovery.plans.editPlan')}
                      </Button>
                    </span>
                  </Tooltip>
                  <Button
                    variant='outlined' size='small'
                    startIcon={<i className='ri-arrow-go-back-line' />}
                    onClick={() => { onFailback(selected.id); closeDrawer() }}
                  >
                    {t('siteRecovery.plans.failback')}
                  </Button>
                  <Tooltip
                    title={selected.status === 'failed_over' ? t('siteRecovery.plans.failedOverTooltip') : t('siteRecovery.plans.testActiveTooltip')}
                    disableHoverListener={!(selected.active_test_execution_id || selected.status === 'executing' || selected.status === 'failed_over')}
                    arrow
                  >
                    <span>
                      <Button
                        variant='outlined' size='small'
                        startIcon={<i className='ri-test-tube-line' />}
                        onClick={() => { onTestFailover(selected.id); closeDrawer() }}
                        disabled={!!selected.active_test_execution_id || selected.status === 'executing' || selected.status === 'failed_over'}
                      >
                        {t('siteRecovery.plans.testFailover')}
                      </Button>
                    </span>
                  </Tooltip>
                  {/* Cleanup only once the test finished — the orchestrator
                      refuses it while the plan is still executing */}
                  {selected.active_test_execution_id && selected.status !== 'executing' && (
                    <Button
                      variant='contained' size='small' color='warning'
                      startIcon={<i className='ri-eraser-line' />}
                      onClick={() => { onCleanupTest(selected.id); closeDrawer() }}
                    >
                      {t('siteRecovery.failover.cleanup')}
                    </Button>
                  )}
                  <Tooltip
                    title={t('siteRecovery.plans.failedOverTooltip')}
                    disableHoverListener={selected.status !== 'failed_over'}
                    arrow
                  >
                    <span>
                      <Button
                        variant='contained' size='small' color='warning'
                        startIcon={<i className='ri-shield-star-line' />}
                        onClick={() => { onFailover(selected.id); closeDrawer() }}
                        disabled={selected.status === 'failed_over'}
                      >
                        {t('siteRecovery.plans.failover')}
                      </Button>
                    </span>
                  </Tooltip>
                </>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>

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
