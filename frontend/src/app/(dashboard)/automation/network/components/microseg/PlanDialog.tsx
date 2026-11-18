'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { MicrosegApiError, microsegApi } from '@/lib/microseg/api'
import { groupRuns } from '@/lib/microseg/groupRuns'
import type { GroupRun, MicrosegPolicy, MicrosegRun } from '@/lib/microseg/types'

import ApplyResult, { GroupApplyResult } from './ApplyResult'
import ClusterRunRow, { shownClusterName, startErrorKey, unreachableKey, type ClusterRunStatus } from './ClusterRunRow'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import PlanNotices, { Notice } from './PlanNotices'
import PlanSteps from './PlanSteps'
import { stepStates, stepsWithOutcome } from './planStepStates'
import RunProgress from './RunProgress'
import TruncatedText from './TruncatedText'
import { ONE_LINE_SX, isVersionConflict } from './dialogParts'
import type { TrackedRun } from './microsegTabTypes'
import { groupPlanSteps } from './planGroups'
import { groupPlanState, planState, type ClusterPlanState } from './planState'
import { firewallOffClusters, type FirewallFindings } from './preflightModel'
import { startedRuns } from './runsInProgress'
import { useGroupGuests } from './useGroupGuests'
import { useGroupRunPoll, type PolledRun } from './useGroupRunPoll'
import { usePlanPreflights } from './usePlanPreflight'
import type { PolicyGuest } from './zoneModel'
import { WriteTip, useMicrosegWrite } from './microsegAccess'

type BodyProps = {
  connectionId: string
  policy: MicrosegPolicy
  reloadPolicy: () => Promise<unknown>
  startRun: (run: TrackedRun) => void
  onClose: () => void
  /** The name of a cluster of the group, for the sections of a plan computed on several clusters. */
  clusterName?: (id: string) => string
}

/** True when a lifecycle answer is that of several clusters (or says why the run of its cluster did not start). */
const isGroup = (runs: GroupRun[] | null): runs is GroupRun[] => !!runs && (runs.length > 1 || runs.some(r => !!r.error))

type PlanContentProps = {
  run: MicrosegRun | null
  readError: unknown
  policy: MicrosegPolicy
  guests: PolicyGuest[]
  recomputeButton: ReactNode
  /** The stale notice is drawn once for the whole group, above the sections. */
  showStale: boolean
  conflict: boolean
}

/** The plan of one cluster: its progress, its failure, or its warnings and steps. */
function PlanContent({ run, readError, policy, guests, recomputeButton, showStale, conflict }: PlanContentProps) {
  const t = useTranslations('microsegPilot.plan')
  const result = run?.result
  const state = planState(run, policy.version, policy.pending_changes, conflict)
  const { steps } = state
  return (
    <>
      {!state.showDiff && !state.failure && <RunProgress run={run} error={readError} runningText={t('computing')} />}
      {state.failure && <Notice severity='error' text={run?.error ? t('failedWith', { error: run.error }) : t('failed')} action={recomputeButton} />}
      {state.showDiff && result && (
        <>
          {showStale && state.stale && (
            <Notice
              severity='warning'
              text={conflict ? t('conflict') : t('stale', { planned: result.version ?? 0, current: policy.version })}
              action={recomputeButton}
            />
          )}
          <PlanNotices result={result} guests={guests} />
          {steps.length === 0
            ? <Notice severity='info' text={policy.pending_changes ? t('nothingRecord') : t('nothing')} />
            : (
              <>
                <Notice severity='info' text={t('summary', { writes: steps.length, guests: groupPlanSteps(steps).byGuest.length })} />
                <PlanSteps steps={steps} guests={guests} />
              </>
            )}
        </>
      )}
    </>
  )
}

/** Where the plan of one cluster stands, for its section header. */
function sectionStatus(cluster: ClusterPlanState): ClusterRunStatus {
  if (cluster.blocking) return 'failed'
  if (cluster.error || cluster.unreachable) return 'skipped'
  if (cluster.running) return 'running'
  if (cluster.state.failure) return 'failed'
  if (cluster.state.collisions || cluster.state.stale) return 'warning'
  return 'done'
}

function PlanBody({ connectionId, policy, reloadPolicy, startRun, onClose, clusterName }: BodyProps) {
  const t = useTranslations('microsegPilot.plan')
  const ts = useTranslations('microsegPilot.settings.clusters')
  const { canWrite } = useMicrosegWrite()
  const api = useMemo(() => microsegApi(connectionId), [connectionId])

  const [planRuns, setPlanRuns] = useState<GroupRun[] | null>(null)
  const [applyRuns, setApplyRuns] = useState<GroupRun[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  // Restarts the plan (Recompute) and, with it, the read of each cluster's firewall checks.
  const [attempt, setAttempt] = useState(0)

  // Each cluster's run is read through its own cluster; one cluster is read exactly as before the shared policies.
  const planPolled = useGroupRunPoll(planRuns)
  const applyPolled = useGroupRunPoll(applyRuns)
  const group = isGroup(planRuns)
  // The guests of every cluster planned (the tab's connection alone until the plan answers): the steps name them.
  const clusterIds = useMemo(() => (planRuns ? planRuns.map(r => r.connection_id) : [connectionId]), [planRuns, connectionId])
  const { guests } = useGroupGuests(clusterIds)
  // The firewall findings of each cluster of a shared policy: one read per cluster per plan (a single cluster too), through its own relay.
  const firewall = usePlanPreflights(clusterIds, attempt, !!planRuns)

  // The plan is asked for, then followed by polling (the request itself answers at once).
  // `attempt` restarts it (Recompute); an answer that arrives after a restart or an unmount is dropped.
  useEffect(() => {
    let cancelled = false
    api.startPlan().then(
      started => { if (!cancelled) setPlanRuns(groupRuns(started, connectionId)) },
      (e: unknown) => { if (!cancelled) setError(e) },
    )
    return () => { cancelled = true }
  }, [api, attempt, connectionId])

  const recompute = () => {
    void reloadPolicy()
    setError(null)
    setConflict(false)
    setPlanRuns(null)
    setAttempt(n => n + 1)
  }

  const apply = async () => {
    setError(null)
    setBusy(true)
    try {
      // Always the current draft: a plan of an older draft cannot be applied (the button is disabled).
      const started = await api.startApply(policy.version)
      setApplyRuns(groupRuns(started, connectionId))
      startRun({ ...startedRuns(started, connectionId), kind: 'apply', label: t('applyLabel'), runningText: t('stripRunning') })
    } catch (e) {
      if (isVersionConflict(e)) {
        setConflict(true)
        void reloadPolicy()
      } else {
        setError(e)
      }
    } finally {
      setBusy(false)
    }
  }

  const recomputeButton = <WriteTip><Button color='inherit' size='small' disabled={!canWrite} onClick={recompute}>{t('recompute')}</Button></WriteTip>

  // Apply is held back while a cluster's firewall is off: nothing would be filtered there (the backend refuses it too).
  const nameOf = (id: string) => shownClusterName(id, connectionId, clusterName, t('cluster.other'))
  const offIds = clusterIds.filter(id => firewall[id]?.off)
  const offReason = offIds.length > 0 && !applyRuns ? t('firewallOffBlock', { names: [...new Set(offIds.map(nameOf))].join(', ') }) : undefined

  const plans = planPolled.map(p => ({ connectionId: p.connection_id, run: p.run, error: p.run_id ? undefined : p.error ?? 'internal', fatal: p.fatal }))
  const groupState = groupPlanState(plans, policy.version, policy.pending_changes, conflict)
  const canApply = group
    ? groupState.applicable && !groupState.stale && !busy && !applyRuns && offIds.length === 0
    : null
  // A disabled button shows no tooltip: why Apply is refused is said on the line, next to it.
  const blockReason = group && !applyRuns && canWrite ? groupState.blockReason : null

  return (
    <>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
        {error instanceof MicrosegApiError && error.code === 'CLUSTER_FIREWALL_OFF'
          ? <FirewallOffRefusal error={error} nameOf={nameOf} />
          : !!error && <MicrosegErrorAlert error={error} onRetry={planRuns ? undefined : recompute} />}
        {group
          ? (
            <GroupPlan
              connectionId={connectionId}
              policy={policy}
              guests={guests}
              clusterName={clusterName}
              firewall={firewall}
              plans={groupState.clusters}
              readErrors={Object.fromEntries(planPolled.map(p => [p.connection_id, p.readError]))}
              stale={groupState.stale}
              staleVersion={groupState.staleVersion}
              conflict={conflict}
              recomputeButton={recomputeButton}
              applyPolled={applyRuns ? applyPolled : null}
              inactive={new Set((policy.clusters ?? []).filter(c => !c.active).map(c => c.connection_id))}
              otherLabel={t('cluster.other')}
              pendingNote={ts('pending')}
            />
          )
          : (
            <SinglePlan
              run={planPolled[0]?.run ?? null}
              readError={planPolled[0]?.readError ?? null}
              applyRun={applyRuns ? applyPolled[0]?.run ?? null : null}
              applyReadError={applyPolled[0]?.readError ?? null}
              applying={!!applyRuns}
              error={error}
              policy={policy}
              guests={guests}
              conflict={conflict}
              recomputeButton={recomputeButton}
              findings={firewall[connectionId]}
            />
          )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('close')}</Button>
        {blockReason && (
          <Typography id='microseg-plan-apply-blocked' variant='body2' color='text.secondary' sx={{ flex: '1 1 auto', minWidth: 0, textAlign: 'right' }}>
            {t(`applyBlocked.${blockReason}`)}
          </Typography>
        )}
        {!applyRuns && (
          <WriteTip title={offReason}>
            <Button
              variant='contained'
              onClick={apply}
              aria-describedby={blockReason ? 'microseg-plan-apply-blocked' : undefined}
              disabled={!canWrite || !(canApply ?? (singleCanApply(planPolled[0]?.run ?? null, policy, conflict, busy) && offIds.length === 0))}
            >
              {t('apply')}
            </Button>
          </WriteTip>
        )}
      </DialogActions>
    </>
  )
}

/**
 * An apply the backend refused because the cluster firewall is off where it would write (CLUSTER_FIREWALL_OFF): nothing
 * was applied anywhere. Says which clusters, as the user knows them (a cluster outside their scope in general words), and
 * what to do. An error block, not a setting row: it may take several lines.
 */
function FirewallOffRefusal({ error, nameOf }: { error: MicrosegApiError; nameOf: (id: string) => string }) {
  const t = useTranslations('microsegPilot.plan')
  const names = [...new Set(firewallOffClusters(error.connections, error.serverMessage).map(nameOf))]
  return (
    <Alert severity='error' sx={{ mb: 2 }}>
      <Typography variant='body2'>{names.length > 0 ? t('firewallOffRefused', { names: names.join(', ') }) : t('firewallOffRefusedAny')}</Typography>
    </Alert>
  )
}

/** Whether the plan of a policy that is not shared may be applied (as before the shared policies). */
function singleCanApply(run: MicrosegRun | null, policy: MicrosegPolicy, conflict: boolean, busy: boolean): boolean {
  const state = planState(run, policy.version, policy.pending_changes, conflict)
  return state.applicable && !state.stale && !busy
}

type SinglePlanProps = {
  run: MicrosegRun | null
  readError: unknown
  applyRun: MicrosegRun | null
  applyReadError: unknown
  applying: boolean
  error: unknown
  policy: MicrosegPolicy
  guests: PolicyGuest[]
  conflict: boolean
  recomputeButton: ReactNode
  /** The firewall findings of the policy's only cluster. */
  findings: FirewallFindings | undefined
}

/** The plan of a policy that is not shared, then its application: drawn exactly as before the shared policies. */
function SinglePlan({ run, readError, applyRun, applyReadError, applying, error, policy, guests, conflict, recomputeButton, findings }: SinglePlanProps) {
  const t = useTranslations('microsegPilot.plan')
  const state = planState(run, policy.version, policy.pending_changes, conflict)
  // Where each step of the plan stands in its application; null when the application is not that of the plan shown.
  const applied = applying ? stepStates(state.steps, applyRun) : null
  const applyDone = applyRun?.status === 'done' || applyRun?.status === 'failed'

  if (applying) {
    return (
      <>
        <RunProgress run={applyRun} error={applyReadError} runningText={t('applying')} />
        {applyRun && applyDone && <ApplyResult run={applyRun} guests={guests} hideSteps={!!applied} />}
        {/* The plan stays on screen while it is applied: each step gets its check as the engine writes it. */}
        {applied && <PlanSteps steps={stepsWithOutcome(state.steps, applyRun)} guests={guests} states={applied} />}
      </>
    )
  }
  // A start error is shown alone (with its retry): no progress line under it.
  if (error && !state.showDiff && !state.failure) return null
  return (
    <>
      <FirewallFindingLines findings={findings} />
      <PlanContent run={run} readError={readError} policy={policy} guests={guests} recomputeButton={recomputeButton} showStale conflict={conflict} />
    </>
  )
}

type GroupPlanProps = {
  connectionId: string
  policy: MicrosegPolicy
  guests: PolicyGuest[]
  clusterName?: (id: string) => string
  /** The firewall findings of each cluster whose checks could be read. */
  firewall: Readonly<Record<string, FirewallFindings>>
  plans: ClusterPlanState[]
  readErrors: Record<string, unknown>
  stale: boolean
  staleVersion: number
  conflict: boolean
  recomputeButton: ReactNode
  /** The application of each cluster once Apply was clicked, null before. */
  applyPolled: PolledRun[] | null
  /** The clusters associated and not applied yet: the first application writes there what their section lists. */
  inactive: ReadonlySet<string>
  otherLabel: string
  pendingNote: string
}

/**
 * The plan of a shared policy: the stale notice once, then one collapsible section per cluster (its chip, its step
 * count, its status), the plan of that cluster inside. Once applied, one line per cluster with its outcome.
 */
function GroupPlan({ connectionId, policy, guests, clusterName, firewall, plans, readErrors, stale, staleVersion, conflict, recomputeButton, applyPolled, inactive, otherLabel, pendingNote }: GroupPlanProps) {
  const t = useTranslations('microsegPilot.plan')
  const nameOf = (id: string) => shownClusterName(id, connectionId, clusterName, otherLabel)

  if (applyPolled) {
    const steps = Object.fromEntries(plans.map(p => [p.connectionId, p.state.steps]))
    return (
      <>
        {!applyPolled.every(r => r.ended) && <RunProgress run={null} error={null} runningText={t('applying')} />}
        <GroupApplyResult runs={applyPolled} steps={steps} guests={guests} nameOf={nameOf} inactive={inactive} />
      </>
    )
  }

  return (
    <>
      {stale && <Notice severity='warning' text={conflict ? t('conflict') : t('stale', { planned: staleVersion, current: policy.version })} action={recomputeButton} />}
      <Box role='list'>
        {plans.map(plan => {
          const id = plan.connectionId
          const status = sectionStatus(plan)
          const count = plan.state.steps.length
          const own = guests.filter(g => g.connectionId === id)
          let text = ''
          // A cluster that blocks Apply says why; an active one that catches up later says that; one never applied
          // (link inactive) that cannot be reached says to apply again once it is.
          const neverApplied = inactive.has(id)
          if (plan.blocking) text = t(plan.fatal ? 'cluster.blocked.unreadable' : 'cluster.blocked.start')
          else if (plan.error === 'no_client') text = t(unreachableKey('cluster.error.no_client', neverApplied))
          else if (plan.error) text = t(`cluster.${startErrorKey(plan.error)}`)
          else if (plan.unreachable) text = t(unreachableKey('cluster.planUnreachable', neverApplied))
          else if (status === 'running') text = t('cluster.computing')
          // The reason stays in this cluster's own section: it may name addresses of its nodes.
          else if (status === 'failed') text = plan.run?.error ? t('failedWith', { error: plan.run.error }) : t('failed')
          return (
            <ClusterRunRow
              key={id}
              connectionId={id}
              name={nameOf(id)}
              status={status}
              text={text}
              note={inactive.has(id) ? pendingNote : undefined}
              notes={<FirewallFindingLines findings={firewall[id]} />}
              extra={plan.error || plan.fatal || plan.unreachable || status === 'running' || plan.state.failure ? undefined : <Chip size='small' variant='outlined' label={t('stepCount', { count })} sx={{ flexShrink: 0 }} />}
            >
              {plan.error || plan.fatal ? undefined : (
                <PlanContent run={plan.run} readError={readErrors[id] ?? null} policy={policy} guests={own} recomputeButton={recomputeButton} showStale={false} conflict={conflict} />
              )}
            </ClusterRunRow>
          )
        })}
      </Box>
    </>
  )
}

/** One line per finding about a cluster's firewall: the cluster firewall off (blocks Apply), the service stopped on nodes. */
function FirewallFindingLines({ findings }: { findings: FirewallFindings | undefined }) {
  const t = useTranslations('microsegPilot.plan')
  if (!findings || (!findings.off && findings.serviceNodes.length === 0)) return null
  const lines = [
    ...(findings.off ? [{ key: 'off', icon: 'ri-close-circle-fill', color: 'error.main', text: t('cluster.firewallOff') }] : []),
    ...(findings.serviceNodes.length > 0 ? [{ key: 'service', icon: 'ri-alert-fill', color: 'warning.main', text: t('cluster.serviceStopped', { nodes: findings.serviceNodes.join(', ') }) }] : []),
  ]
  return (
    <Box data-testid='plan-firewall-findings' sx={{ minWidth: 0 }}>
      {lines.map(line => (
        <Box key={line.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 28, pl: 1, minWidth: 0 }}>
          <Box component='i' aria-hidden className={line.icon} sx={{ color: line.color, fontSize: 18, width: 18, flexShrink: 0 }} />
          <TruncatedText text={line.text} variant='body2' color='text.secondary' sx={{ minWidth: 0 }} />
        </Box>
      ))}
    </Box>
  )
}

type Props = BodyProps & { open: boolean }

/** The plan of the draft: what would be written to Proxmox, then the apply and its outcome. */
export default function PlanDialog({ open, onClose, ...body }: Props) {
  const t = useTranslations('microsegPilot.plan')
  return (
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth aria-labelledby='microseg-plan-title'>
      <DialogTitle id='microseg-plan-title' sx={ONE_LINE_SX}>{t('title')}</DialogTitle>
      <PlanBody {...body} onClose={onClose} />
    </Dialog>
  )
}
