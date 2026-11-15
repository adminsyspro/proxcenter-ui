'use client'

import { useState } from 'react'

import { MicrosegApiError, microsegApi } from '@/lib/microseg/api'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

export type ControlAction = 'stop' | 'resume' | 'confirmWrites'

/** What the banner tells after an action went through. `stop` is the emergency stop flag the answer was sent against. */
export type ControlNotice = { type: 'leader'; stop: boolean | undefined } | { type: 'confirmed' }

/** The refusals that keep the dialog open: what cures them is done from the dialog itself. */
const DIALOG_ERROR_CODES: ReadonlySet<string> = new Set(['SOCLE_MISSING'])

/**
 * The engine controls of the Micro-segmentation tab: the status, and the three confirmed actions (emergency stop,
 * resume, confirm the held writes). The banner shows their outcome and the sub-tabs row holds the stop button, so
 * the state lives above both.
 */
export function useMicrosegControls(connectionId: string, statusRefreshMs?: number) {
  const { data: status, error: statusError, reload } = useMicrosegStatus(connectionId || null, statusRefreshMs)

  // `action` outlives the dialog so its text does not blank out during the closing fade.
  const [action, setAction] = useState<ControlAction>('stop')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)
  // A refusal the dialog itself explains (resume without the management rules): the dialog stays open on it.
  const [dialogError, setDialogError] = useState<MicrosegApiError | null>(null)
  const [notice, setNotice] = useState<ControlNotice | null>(null)

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
        const result = await api.emergencyStop(action === 'stop')
        if (result.applied_by === 'leader') setNotice({ type: 'leader', stop: status?.emergency_stop })
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
    action, open, busy, actionError, dialogError, notice,
    ask, run,
    close: () => setOpen(false),
    clearNotice: () => setNotice(null),
    clearActionError: () => setActionError(null),
  }
}

export type MicrosegControls = ReturnType<typeof useMicrosegControls>
