'use client'

import { useCallback, useState } from 'react'

/**
 * One in-flight stop request, described by the row that offers it: its id (so
 * the button can stay disabled once PVE or the orchestrator has acknowledged),
 * the call itself, and the wording the confirmation shows.
 */
export type StopTaskTarget = {
  id: string
  run: () => Promise<{ ok: boolean; error?: string }>
  title?: string
  body?: string
  warning?: string
  confirmLabel?: string
}

/**
 * Confirm-then-stop state shared by the three surfaces that carry a stop
 * button on a task row (#974): the two tabs of the taskbar and the Task
 * Center table. Each one only supplies the target; the ask/confirm dance, the
 * busy flag, the error and the "already asked to stop" set live here.
 *
 * A stopped row is NOT removed optimistically: the worker decides when it
 * really ends, and the next poll is what flips the status chip. The button is
 * only disabled in the meantime, so a second click cannot fire a second DELETE.
 */
export function useStopTask(onStopped?: () => void | Promise<void>) {
  const [target, setTarget] = useState<StopTaskTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stopped, setStopped] = useState<Record<string, true>>({})

  const ask = useCallback((next: StopTaskTarget) => {
    setError(null)
    setTarget(next)
  }, [])

  const dismiss = useCallback(() => {
    setTarget(prev => (busy ? prev : null))
  }, [busy])

  const clearError = useCallback(() => setError(null), [])

  const confirm = useCallback(async () => {
    if (!target) return

    setBusy(true)
    const { ok, error: failure } = await target.run()
    setBusy(false)
    setTarget(null)

    if (!ok) {
      // A 403 (no node.manage / vm.migrate) and a 400 on a task that just
      // finished both land here: saying nothing would look like the click was
      // swallowed, which is exactly what #767 reported about the old buttons.
      setError(failure || null)

      return
    }

    setStopped(prev => ({ ...prev, [target.id]: true }))
    await onStopped?.()
  }, [target, onStopped])

  const isStopping = useCallback((id: string) => !!stopped[id], [stopped])

  return { target, busy, error, ask, dismiss, confirm, clearError, isStopping }
}
