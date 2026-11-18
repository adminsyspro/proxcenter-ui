'use client'

import { useCallback, useState } from 'react'

import { MicrosegApiError, microsegApi } from '@/lib/microseg/api'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

export type ControlAction = 'stop' | 'resume' | 'confirmWrites'

/** What the banner tells after an action went through. `stop` is the emergency stop flag the answer was sent against. */
export type ControlNotice = { type: 'leader'; stop: boolean | undefined } | { type: 'confirmed' }

/**
 * An emergency stop set (`on`) or lifted that went through: on a shared policy the banner follows each cluster's own
 * status until it is aligned. A new object for every action.
 */
export type StopFollowUp = { on: boolean }

/** The refusals that keep the dialog open: what cures them is done from the dialog itself. */
const DIALOG_ERROR_CODES: ReadonlySet<string> = new Set(['SOCLE_MISSING'])

/**
 * The engine controls of the Micro-segmentation tab: the status, and the three confirmed actions (emergency stop,
 * resume, confirm the held writes). The banner shows their outcome and the sub-tabs row holds the stop button, so
 * the state lives above both.
 */
/**
 * `reloadPolicy`, given for a shared policy only: the draft is read again once a stop or a lift went through (the
 * backend records on each link whether the stop turned its firewall off, which the follow-up of the lift reads).
 */
export function useMicrosegControls(connectionId: string, statusRefreshMs?: number, clusterName?: (id: string) => string, reloadPolicy?: () => Promise<unknown>) {
  const { data: status, error: statusError, reload } = useMicrosegStatus(connectionId || null, statusRefreshMs)

  // `action` outlives the dialog so its text does not blank out during the closing fade.
  const [action, setAction] = useState<ControlAction>('stop')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)
  // A refusal the dialog itself explains (resume without the management rules): the dialog stays open on it.
  const [dialogError, setDialogError] = useState<MicrosegApiError | null>(null)
  const [notice, setNotice] = useState<ControlNotice | null>(null)
  // Kept with the connection it was made on: another connection (another policy) starts with none.
  const [follow, setFollow] = useState<{ up: StopFollowUp; connectionId: string } | null>(null)
  const followUp = follow?.connectionId === connectionId ? follow.up : null
  const clearFollowUp = useCallback(() => setFollow(null), [])

  const ask = (a: ControlAction) => { setAction(a); setDialogError(null); setOpen(true) }

  const run = async () => {
    const api = microsegApi(connectionId)
    setBusy(true)
    setActionError(null)
    setDialogError(null)
    setNotice(null)
    let keepOpen = false
    try {
      if (action === 'confirmWrites') {
        await api.confirmWrites()
        setNotice({ type: 'confirmed' })
      } else {
        // One request through the tab's connection: the backend stops or lifts every cluster of the policy.
        const result = await api.emergencyStop(action === 'stop')
        if (result.applied_by === 'leader') setNotice({ type: 'leader', stop: status?.emergency_stop })
        await reloadPolicy?.().catch(() => undefined)
        setFollow({ up: { on: action === 'stop' }, connectionId })
      }
      await reload()
    } catch (e) {
      if (e instanceof MicrosegApiError && DIALOG_ERROR_CODES.has(e.code)) {
        keepOpen = true
        setDialogError(e)
      } else {
        setActionError(e)
      }
    } finally {
      setBusy(false)
      if (!keepOpen) setOpen(false)
    }
  }

  return {
    status, statusError, reload,
    /** The name of a cluster of a shared policy, for what the banner says of the clusters (the pending changes). */
    clusterName,
    action, open, busy, actionError, dialogError, notice,
    /** The last stop or lift that went through, until the banner saw every cluster follow it. */
    followUp,
    clearFollowUp,
    ask, run,
    close: () => setOpen(false),
    clearNotice: () => setNotice(null),
    clearActionError: () => setActionError(null),
  }
}

export type MicrosegControls = ReturnType<typeof useMicrosegControls>
