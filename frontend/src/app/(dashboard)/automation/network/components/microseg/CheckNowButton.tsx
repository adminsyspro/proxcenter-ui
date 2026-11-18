'use client'

import { useCallback, useMemo, useState } from 'react'
import { Button, CircularProgress } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { GroupRun, MicrosegStatus } from '@/lib/microseg/types'

import CheckDialog from './CheckDialog'
import { shownClusterName } from './ClusterRunRow'
import type { TrackedRun } from './microsegTabTypes'
import { WriteTip, useMicrosegClusterWrite } from './microsegAccess'
import { startedRuns } from './runsInProgress'
import { useGroupCheck, useMicrosegCheck } from './useMicrosegCheck'

type Props = {
  connectionId: string
  /** Something is deployed (the policy has a revision): the engine only checks a deployed policy. */
  deployed: boolean
  /** The shared status of the tab: `check_pending` says the engine has a check queued. */
  status: MicrosegStatus | undefined
  statusError: unknown
  reloadStatus: () => Promise<unknown>
  /** True while this window's check waits in the queue (the tab reads the status faster). */
  onQueued: (queued: boolean) => void
  /** Follows the run of the check in the strip under the banner. */
  startRun: (run: TrackedRun) => void
  /** The check has ended: the draft, the status, the drifts, the suggestions and the snapshot are read again. */
  onDone: () => void
  onOpenDrifts: () => void
  /** The active clusters of a shared policy, once the group is known: the check is asked on each of them. */
  activeIds?: string[]
  clusterName?: (id: string) => string
}

const NO_IDS: string[] = []

/**
 * "Check now", on the sub-tabs row: asks the engine for a full pass at once, and opens the window that follows it.
 * While a check is queued the button says so; a click while this window's own check is going on reopens it.
 */
export default function CheckNowButton({ connectionId, deployed, status, statusError, reloadStatus, onQueued, startRun, onDone, onOpenDrifts, activeIds = NO_IDS, clusterName }: Props) {
  const t = useTranslations('microsegPilot.check')
  const { canWriteOn } = useMicrosegClusterWrite()
  const [open, setOpen] = useState(false)

  const onTracked = useCallback((runId: string) => {
    startRun({ runId, kind: 'check', label: t('title'), runningText: t('runningText') })
  }, [startRun, t])
  const check = useMicrosegCheck({ connectionId, status, statusError, reloadStatus, onQueued, onTracked, onDone })
  // A shared policy: the check of every active cluster the user sees, followed as one group run (also when the one
  // active cluster is not the tab's: a link not applied yet answers 404 to a check). A cluster outside the user's scope
  // is neither asked nor listed, and neither is one the user may not write (a check is a write of that cluster alone).
  const checkedIds = useMemo(
    () => activeIds.filter(id => shownClusterName(id, connectionId, clusterName) !== null && canWriteOn(id)),
    [activeIds, connectionId, clusterName, canWriteOn],
  )
  // No active cluster known: the tab's own check; otherwise at least one cluster to check.
  const canWrite = activeIds.length === 0 ? canWriteOn(connectionId) : checkedIds.length > 0
  const grouped = checkedIds.length > 1 || (checkedIds.length === 1 && checkedIds[0] !== connectionId)
  const onGroupTracked = useCallback((runs: GroupRun[]) => {
    startRun({ ...startedRuns({ run_id: '', runs }, connectionId), kind: 'check', label: t('title'), runningText: t('runningText') })
  }, [startRun, t, connectionId])
  const group = useGroupCheck({ activeIds: checkedIds, onTracked: onGroupTracked, onDone })
  const active = grouped ? group.active : check.active
  const pending = !!status?.engine.check_pending

  const onClick = () => {
    setOpen(true)
    if (active) return
    if (grouped) void group.start()
    else void check.start()
  }
  const openDrifts = () => {
    setOpen(false)
    onOpenDrifts()
  }

  // The own check of this window stays reachable while it goes on, even when the status says it is queued.
  const waiting = pending && !active

  return (
    <>
      <WriteTip allowed={canWrite} title={deployed ? undefined : t('notDeployed')}>
        <Button
          size='small'
          variant='outlined'
          startIcon={pending ? <CircularProgress size={14} color='inherit' /> : <i className='ri-search-eye-line' />}
          onClick={onClick}
          disabled={!canWrite || !deployed || waiting}
          sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {pending ? t('pending') : t('button')}
        </Button>
      </WriteTip>
      {open && (
        <CheckDialog
          check={check}
          group={grouped ? group : undefined}
          connectionId={connectionId}
          clusterName={clusterName}
          onClose={() => setOpen(false)}
          onOpenDrifts={openDrifts}
        />
      )}
    </>
  )
}
