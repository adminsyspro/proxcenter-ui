'use client'

import { useState } from 'react'

import { microsegApi } from '@/lib/microseg/api'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

export type ControlAction = 'stop' | 'resume' | 'confirmWrites'

/** What the banner tells after an action went through. `stop` is the emergency stop flag the answer was sent against. */
export type ControlNotice = { type: 'leader'; stop: boolean | undefined } | { type: 'confirmed' }

/**
 * The engine controls of the Micro-segmentation tab: the status, and the three confirmed actions (emergency stop,
 * resume, confirm the held writes). The banner shows their outcome and the sub-tabs row holds the stop button, so
 * the state lives above both.
 */
export function useMicrosegControls(connectionId: string) {
  const { data: status, error: statusError, reload } = useMicrosegStatus(connectionId || null)

  // `action` outlives the dialog so its text does not blank out during the closing fade.
  const [action, setAction] = useState<ControlAction>('stop')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)
  const [notice, setNotice] = useState<ControlNotice | null>(null)

  const ask = (a: ControlAction) => { setAction(a); setOpen(true) }

  const run = async () => {
    const api = microsegApi(connectionId)
    setBusy(true)
    setActionError(null)
    setNotice(null)
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
      setActionError(e)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return {
    status, statusError, reload,
    action, open, busy, actionError, notice,
    ask, run,
    close: () => setOpen(false),
    clearNotice: () => setNotice(null),
    clearActionError: () => setActionError(null),
  }
}

export type MicrosegControls = ReturnType<typeof useMicrosegControls>
