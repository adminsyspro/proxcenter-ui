'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import { useTranslations } from 'next-intl'

import { isPlanStale, microsegApi } from '@/lib/microseg/api'
import type { MicrosegPolicy } from '@/lib/microseg/types'
import { useMicrosegRun } from '@/lib/microseg/useMicroseg'

import ApplyResult from './ApplyResult'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import PlanNotices, { Notice } from './PlanNotices'
import PlanSteps from './PlanSteps'
import RunProgress from './RunProgress'
import { isVersionConflict } from './dialogParts'
import type { TrackedRun } from './microsegTabTypes'
import { groupPlanSteps } from './planGroups'
import { useZoneGuests } from './useZoneGuests'

type BodyProps = {
  connectionId: string
  policy: MicrosegPolicy
  reloadPolicy: () => Promise<unknown>
  startRun: (run: TrackedRun) => void
  onClose: () => void
}

function PlanBody({ connectionId, policy, reloadPolicy, startRun, onClose }: BodyProps) {
  const t = useTranslations('microsegPilot.plan')
  const api = useMemo(() => microsegApi(connectionId), [connectionId])
  const { guests } = useZoneGuests(connectionId)

  const [planRunId, setPlanRunId] = useState<string | null>(null)
  const [applyRunId, setApplyRunId] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)

  const planRun = useMicrosegRun(connectionId, planRunId)
  const applyRun = useMicrosegRun(connectionId, applyRunId)

  // The plan is asked for, then followed by polling (the request itself answers at once).
  // `attempt` restarts it (Recompute); an answer that arrives after a restart or an unmount is dropped.
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    api.startPlan().then(
      ({ run_id }) => { if (!cancelled) setPlanRunId(run_id) },
      (e: unknown) => { if (!cancelled) setError(e) },
    )
    return () => { cancelled = true }
  }, [api, attempt])

  const recompute = () => {
    setError(null)
    setConflict(false)
    setPlanRunId(null)
    setAttempt(n => n + 1)
  }

  const apply = async () => {
    setError(null)
    setBusy(true)
    try {
      // Always the current draft: a plan of an older draft cannot be applied (the button is disabled).
      const { run_id } = await api.startApply(policy.version)
      setApplyRunId(run_id)
      startRun({ runId: run_id, kind: 'apply', label: t('applyLabel'), runningText: t('stripRunning') })
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

  const run = planRun.run
  const result = run?.result
  const steps = result?.plan ?? []
  const planFailed = run?.status === 'failed'
  const planReady = !!run && run.status === 'done' && !!result
  const stale = conflict || (!!run && isPlanStale(run, policy.version))
  const blocked = (result?.collisions?.length ?? 0) > 0
  const canApply = planReady && !stale && !blocked && steps.length > 0 && !busy && !applyRunId

  const recomputeButton = <Button color='inherit' size='small' onClick={recompute}>{t('recompute')}</Button>

  return (
    <>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
        {!!error && <MicrosegErrorAlert error={error} onRetry={planRunId ? undefined : recompute} onClose={() => setError(null)} />}

        {!applyRunId && !planReady && !planFailed && !error && (
          <RunProgress run={run} error={planRun.error} runningText={t('computing')} />
        )}
        {!applyRunId && planFailed && (
          <Notice severity='error' text={run?.error ? t('failedWith', { error: run.error }) : t('failed')} action={recomputeButton} />
        )}

        {!applyRunId && planReady && result && (
          <>
            {stale && (
              <Notice
                severity='warning'
                text={conflict ? t('conflict') : t('stale', { planned: result.version ?? 0, current: policy.version })}
                action={recomputeButton}
              />
            )}
            <PlanNotices result={result} guests={guests} />
            {steps.length === 0
              ? <Notice severity='info' text={t('nothing')} />
              : (
                <>
                  <Notice severity='info' text={t('summary', { writes: steps.length, guests: groupPlanSteps(steps).byGuest.length })} />
                  <PlanSteps steps={steps} guests={guests} />
                </>
              )}
          </>
        )}

        {applyRunId && (
          <>
            <RunProgress run={applyRun.run} error={applyRun.error} runningText={t('applying')} />
            {applyRun.run && applyRun.done && <ApplyResult run={applyRun.run} guests={guests} />}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('close')}</Button>
        {!applyRunId && (
          <Button variant='contained' onClick={apply} disabled={!canApply}>{t('apply')}</Button>
        )}
      </DialogActions>
    </>
  )
}

type Props = BodyProps & { open: boolean }

/** The plan of the draft: what would be written to Proxmox, then the apply and its outcome. */
export default function PlanDialog({ open, onClose, ...body }: Props) {
  const t = useTranslations('microsegPilot.plan')
  return (
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth aria-labelledby='microseg-plan-title'>
      <DialogTitle id='microseg-plan-title' sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('title')}</DialogTitle>
      <PlanBody {...body} onClose={onClose} />
    </Dialog>
  )
}
