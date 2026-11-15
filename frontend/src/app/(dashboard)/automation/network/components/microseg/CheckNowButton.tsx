'use client'

import { useCallback, useState } from 'react'
import { Button, CircularProgress } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegStatus } from '@/lib/microseg/types'

import CheckDialog from './CheckDialog'
import type { TrackedRun } from './microsegTabTypes'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import { useMicrosegCheck } from './useMicrosegCheck'

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
}

/**
 * "Check now", on the sub-tabs row: asks the engine for a full pass at once, and opens the window that follows it.
 * While a check is queued the button says so; a click while this window's own check is going on reopens it.
 */
export default function CheckNowButton({ connectionId, deployed, status, statusError, reloadStatus, onQueued, startRun, onDone, onOpenDrifts }: Props) {
  const t = useTranslations('microsegPilot.check')
  const { canWrite } = useMicrosegWrite()
  const [open, setOpen] = useState(false)

  const onTracked = useCallback((runId: string) => {
    startRun({ runId, kind: 'check', label: t('title'), runningText: t('runningText') })
  }, [startRun, t])
  const check = useMicrosegCheck({ connectionId, status, statusError, reloadStatus, onQueued, onTracked, onDone })
  const pending = !!status?.engine.check_pending

  const onClick = () => {
    setOpen(true)
    if (!check.active) void check.start()
  }
  const openDrifts = () => {
    setOpen(false)
    onOpenDrifts()
  }

  // The own check of this window stays reachable while it goes on, even when the status says it is queued.
  const waiting = pending && !check.active

  return (
    <>
      <WriteTip title={deployed ? undefined : t('notDeployed')}>
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
      {open && <CheckDialog check={check} connectionId={connectionId} onClose={() => setOpen(false)} onOpenDrifts={openDrifts} />}
    </>
  )
}
