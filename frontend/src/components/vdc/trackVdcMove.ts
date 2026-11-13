// Poll a move between vDCs (#1335) and mirror it into the ProxCenter task
// bar. The poll lives at module level, not in the dialog, so it carries on
// after the dialog closed; the server finishes the move either way.

import type { PCTask } from '@/contexts/ProxCenterTasksContext'

export const MOVE_POLL_MS = 5_000

type Texts = { copying: string; finalizing: string; done: string; doneWithWarnings: string }
type Update = Partial<PCTask>

const active = new Map<string, ReturnType<typeof setInterval>>()

/** One task update from a move status, or null while nothing changed worth showing. */
export function moveToTaskUpdate(move: { status: string; error?: string | null; warnings?: unknown[] }, texts: Texts): Update {
  switch (move.status) {
    case 'done':
      return { status: 'done', progress: 100, detail: (move.warnings?.length ?? 0) > 0 ? texts.doneWithWarnings : texts.done }
    case 'failed':
      return { status: 'error', progress: 100, error: move.error || undefined }
    case 'finalizing':
      return { status: 'running', progress: 90, detail: texts.finalizing }
    default:
      return { status: 'running', progress: 40, detail: texts.copying }
  }
}

export function trackVdcMove(moveId: string, onUpdate: (update: Update) => void, texts: Texts, fetchImpl: typeof fetch = fetch): void {
  if (active.has(moveId)) return
  const tick = async () => {
    try {
      const res = await fetchImpl(`/api/v1/vdc/moves/${encodeURIComponent(moveId)}`, { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      const update = moveToTaskUpdate(json.data, texts)
      onUpdate(update)
      if (update.status === 'done' || update.status === 'error') stopTracking(moveId)
    } catch {
      // Transient: the next tick retries.
    }
  }
  active.set(moveId, setInterval(() => { void tick() }, MOVE_POLL_MS))
  void tick()
}

export function stopTracking(moveId: string): void {
  const timer = active.get(moveId)
  if (timer) clearInterval(timer)
  active.delete(moveId)
}
