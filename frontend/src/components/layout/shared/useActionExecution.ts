'use client'

import { useEffect, useState } from 'react'

import type { ActionCardsPayload } from '@/lib/ai/actions/cards'
import type { ActionCard } from '@/lib/ai/actions/types'

/**
 * Running the action cards of the assistant (roadmap#188), one at a time per
 * widget, and following the Proxmox task each one starts.
 *
 * PVE cost: every poll of `/api/v1/tasks/...` reads the task status and its
 * log, two protected calls on the node. So the next poll is planned only once
 * the previous one answered (never an interval), there is only ever one task
 * followed per widget, and the follow-up pauses while nobody can see it (tab
 * hidden, panel closed) and gives up after 15 minutes: the task keeps running
 * in Proxmox and the Task Center has it.
 */

export const ACTION_POLL_MS = 5_000
// Counted from the dispatch, hidden and closed-panel time included.
export const ACTION_TRACK_MAX_MS = 15 * 60 * 1000
const MAX_POLL_ERRORS = 3

const EXECUTE_URL = '/api/v1/ai/actions/execute'

// A failed dispatch can be sent again: the route did not run, or did not
// answer. Every other refusal means the card itself is no longer good.
const RETRYABLE = new Set(['route-refused', 'internal-error', 'network', 'confirmation-required'])

export type ActionRun =
  | { phase: 'sending' }
  | { phase: 'tracking'; progress?: number }
  | { phase: 'done'; code?: 'already-executed' | 'warnings' }
  | { phase: 'failed'; code: string; message: string; retryable: boolean }
  | { phase: 'untracked' }

export type ActionRuns = Record<string, ActionRun>

type Outcome = { ok: true; warnings?: boolean } | { ok: false; reason: string } | { unknown: true }

type FinishedListener = (card: ActionCard, line: string) => void

// ---------------------------------------------------------------------------
// The line the model reads afterwards
// ---------------------------------------------------------------------------

/** The action in a few words, the same wording as the server's `describeCard`. */
export function describeAction(card: Pick<ActionCard, 'kind' | 'target' | 'params'>): string {
  const t = card.target
  const guest = t.vmid === undefined ? t.name : `${t.name} (${t.vmid})`

  switch (card.kind) {
    case 'migrate':
      return `migrate ${guest} from ${t.node} to ${String(card.params.target)}`
    case 'drs_apply':
      return `apply the DRS move of ${guest} on ${t.node}`
    case 'backup_add':
      return `add ${guest} to backup job ${String(card.params.jobId)}`
    case 'snapshot':
      return `snapshot ${guest} on ${t.node} as "${String(card.params.name)}"`
    case 'maintenance':
      return card.params.mode === 'exit' ? `take ${t.name} out of maintenance` : `put ${t.name} in maintenance`
    default:
      return `${card.kind} ${guest} on ${t.node}`
  }
}

/**
 * What the next turn tells the model about a finished action. A failure only
 * carries its code: the route message and the task log can quote Proxmox text
 * (a log line, a guest note) that anyone with write access there can plant,
 * and assistant turns ground the targets of later proposals.
 */
export function resultLine(card: ActionCard, outcome: Outcome): string {
  const what = `Action ${describeAction(card)}`

  if ('unknown' in outcome) return `${what}: started, outcome unknown`

  if (outcome.ok) return outcome.warnings ? `${what}: done with warnings` : `${what}: done`

  return `${what}: failed (${outcome.reason})`
}

type WithActions = { content: string; actions?: ActionCardsPayload; actionResults?: string[] }

const carries = (m: WithActions, actionId: string) =>
  Boolean(
    m.actions?.cards.some(c => c.actionId === actionId) ||
      m.actions?.plans.some(p => p.steps.some(s => s.card?.actionId === actionId))
  )

/**
 * The line goes on the answer that proposed the card rather than in a turn of
 * its own: two assistant turns in a row are refused by some providers, and the
 * bubble on screen stays as it was.
 */
export function withActionResult<M extends WithActions>(messages: M[], actionId: string, line: string): M[] {
  const index = messages.findIndex(m => carries(m, actionId))

  if (index < 0) return messages

  const next = [...messages]

  next[index] = { ...next[index], actionResults: [...(next[index].actionResults ?? []), line] }

  return next
}

/** The text of a turn as sent to the model: the answer, then what was run from it. */
export const historyContent = (m: WithActions): string =>
  m.actionResults?.length ? `${m.content}\n\n${m.actionResults.join('\n')}` : m.content

/**
 * The id that binds the cards to this thread. `randomUUID` only exists in a
 * secure context, and ProxCenter is often reached over plain HTTP on a LAN,
 * where `getRandomValues` still works.
 */
export function newConversationId(): string {
  const c = globalThis.crypto

  if (typeof c.randomUUID === 'function') return c.randomUUID()

  const bytes = c.getRandomValues(new Uint8Array(16))

  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// The engine: plain closures, so a timer or a late answer never reads a stale
// React render. React only feeds it the inputs and renders `runs`.
// ---------------------------------------------------------------------------

type Track = {
  card: ActionCard
  url: string
  startedAt: number
  errors: number
  timer: ReturnType<typeof setTimeout> | null
  inFlight: boolean
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function createEngine(setRuns: (update: (prev: ActionRuns) => ActionRuns) => void) {
  // Bumped by reset and unmount: an answer from an older generation is dropped.
  let gen = 0
  let active: string | null = null
  let track: Track | null = null
  let controller: AbortController | null = null
  let paused = false
  let conversationId = ''
  let onFinished: FinishedListener | undefined

  const setRun = (actionId: string, run: ActionRun) => setRuns(prev => ({ ...prev, [actionId]: run }))
  const watched = () => !paused && !(typeof document !== 'undefined' && document.hidden)

  const stopTimer = () => {
    if (track?.timer) clearTimeout(track.timer)
    if (track) track.timer = null
  }

  const finish = (card: ActionCard, run: ActionRun, outcome: Outcome) => {
    stopTimer()
    track = null
    controller = null
    active = null
    setRun(card.actionId, run)

    // Only a final outcome reaches the model: a failure the user can still
    // retry would leave "failed" then "done" for the same card.
    const retryLater = run.phase === 'failed' && run.retryable && Date.now() < card.expiresAt

    if (!retryLater) onFinished?.(card, resultLine(card, outcome))
  }

  const timedOut = (current: Track) => Date.now() - current.startedAt >= ACTION_TRACK_MAX_MS

  const settle = (current: Track, body: Record<string, unknown>) => {
    if (body.status !== 'stopped') {
      current.errors = 0
      setRun(current.card.actionId, {
        phase: 'tracking',
        ...(typeof body.progress === 'number' && Number.isFinite(body.progress) ? { progress: body.progress } : {})
      })
      schedule()

      return
    }

    const exit = str(body.exitstatus)

    // Proxmox ends many good tasks (backup, migration, replication) with
    // "WARNINGS: n": the action ran, the next step of a plan may go on.
    if (exit === 'OK') {
      finish(current.card, { phase: 'done' }, { ok: true })
    } else if (exit.startsWith('WARNINGS')) {
      finish(current.card, { phase: 'done', code: 'warnings' }, { ok: true, warnings: true })
    } else {
      finish(
        current.card,
        { phase: 'failed', code: 'task-failed', message: str(body.failureReason) || str(body.exitstatus), retryable: false },
        { ok: false, reason: 'task-failed' }
      )
    }
  }

  const poll = () => {
    const current = track

    if (!current) return
    current.timer = null
    if (!watched()) return

    if (timedOut(current)) {
      finish(current.card, { phase: 'untracked' }, { unknown: true })

      return
    }

    const mine = gen

    current.inFlight = true
    fetch(current.url, { signal: controller?.signal })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: unknown) => {
        if (mine !== gen || track !== current) return
        current.inFlight = false
        settle(current, typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {})
      })
      .catch(() => {
        if (mine !== gen || track !== current) return
        current.inFlight = false
        current.errors += 1

        if (current.errors >= MAX_POLL_ERRORS) finish(current.card, { phase: 'untracked' }, { unknown: true })
        else schedule()
      })
  }

  // The next poll is planned from the answer of the previous one, never ahead.
  function schedule() {
    if (!track || track.timer || track.inFlight || !watched()) return

    if (timedOut(track)) {
      finish(track.card, { phase: 'untracked' }, { unknown: true })

      return
    }

    track.timer = setTimeout(poll, ACTION_POLL_MS)
  }

  const answered = (card: ActionCard, body: Record<string, unknown> | null) => {
    if (body?.ok === true) {
      const result = (typeof body.result === 'object' && body.result !== null ? body.result : {}) as Record<string, unknown>
      const upid = str(result.upid)

      if (!upid.startsWith('UPID:')) {
        finish(card, { phase: 'done' }, { ok: true })

        return
      }

      // For a migration this is the source node, where Proxmox runs the task.
      const connId = str(result.connId) || card.target.connId
      const node = str(result.node) || card.target.node

      track = {
        card,
        url: `/api/v1/tasks/${encodeURIComponent(connId)}/${encodeURIComponent(node)}/${encodeURIComponent(upid)}?summary=1`,
        startedAt: Date.now(),
        errors: 0,
        timer: null,
        inFlight: false
      }
      setRun(card.actionId, { phase: 'tracking' })
      schedule()

      return
    }

    const code = str(body?.code) || 'network'

    // Run already (another tab, a click before a reload): the server counts it
    // as done, so the next step of a plan unlocks here too.
    if (code === 'already-executed') {
      finish(card, { phase: 'done', code }, { ok: true })

      return
    }

    finish(card, { phase: 'failed', code, message: str(body?.message), retryable: RETRYABLE.has(code) }, { ok: false, reason: code })
  }

  return {
    configure(next: { conversationId: string; onFinished?: FinishedListener }) {
      conversationId = next.conversationId
      onFinished = next.onFinished
    },

    execute(card: ActionCard, confirmed: boolean) {
      // Checked here and not on the rendered `busy`: a double click lands
      // before React re-renders.
      if (active) return

      const mine = gen

      active = card.actionId
      // Aborts the task polls only.
      controller = new AbortController()
      setRun(card.actionId, { phase: 'sending' })

      // Never aborted: once sent, the server may already have dispatched, so a
      // reset or unmount drops the answer through `gen` instead.
      fetch(EXECUTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card, conversationId, ...(confirmed ? { confirmed: true } : {}) })
      })
        .then(res => res.json().catch(() => null))
        .then((body: unknown) => {
          if (mine !== gen) return
          answered(card, typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null)
        })
        .catch(() => {
          if (mine === gen) answered(card, null)
        })
    },

    setPaused(value: boolean) {
      paused = value
      if (paused) stopTimer()
      else schedule()
    },

    visibilityChanged() {
      if (watched()) schedule()
      else stopTimer()
    },

    /** Drops the work in progress (aborting a task poll, not the execute POST); the task keeps running in Proxmox. */
    stop() {
      gen += 1
      stopTimer()
      track = null
      active = null
      controller?.abort()
      controller = null
    }
  }
}

/**
 * One per widget. `paused` is true while the panel is closed; `onFinished`
 * gets the line to add to the history once an action is over.
 */
export function useActionExecution({
  conversationId,
  paused,
  onFinished
}: {
  conversationId: string
  paused: boolean
  onFinished?: FinishedListener
}) {
  const [runs, setRuns] = useState<ActionRuns>({})
  const [engine] = useState(() => createEngine(setRuns))

  useEffect(() => {
    engine.configure({ conversationId, onFinished })
  }, [engine, conversationId, onFinished])

  useEffect(() => {
    engine.setPaused(paused)
  }, [engine, paused])

  useEffect(() => {
    const onVisibility = () => engine.visibilityChanged()

    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      engine.stop()
    }
  }, [engine])

  const busy = Object.values(runs).some(r => r.phase === 'sending' || r.phase === 'tracking')

  return {
    runs,
    busy,
    execute: engine.execute,
    /** A new conversation: nothing of the previous one is kept or followed. */
    reset: () => {
      engine.stop()
      setRuns({})
    }
  }
}

export type ActionExecution = ReturnType<typeof useActionExecution>
