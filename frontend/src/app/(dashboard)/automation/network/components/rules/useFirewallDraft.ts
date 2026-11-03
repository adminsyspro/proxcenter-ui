'use client'

import { useCallback, useMemo, useState } from 'react'

import { EMPTY_DRAFT, deriveOps, parseStoredDraft, rebaseDraft, serializeDraft, type FirewallDraft } from '@/lib/firewall/draft'
import { PUBLISH_CONFIRM_ABOVE, PUBLISH_MAX_WRITES, opWrites, type PublishOp, type PublishResult } from '@/lib/firewall/publishOps'

const storageKey = (connectionId: string) => `firewall.draft.${connectionId}`
const publishedKey = (connectionId: string) => `firewall.published.${connectionId}`

function readStored(key: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.sessionStorage?.removeItem(key)
    else globalThis.sessionStorage?.setItem(key, value)
  } catch {
    // Blocked storage: the draft lives in memory only.
  }
}

/** The first operations whose Proxmox writes fit in one publish (a creation with its move, a guest switch: 2 each). */
export function firstBatch(ops: PublishOp[], maxWrites = PUBLISH_MAX_WRITES): PublishOp[] {
  let writes = 0
  let n = 0
  while (n < ops.length && writes + opWrites(ops[n]) <= maxWrites) writes += opWrites(ops[n++])
  return ops.slice(0, n)
}

/** Why the last publish stopped: the server's message and the operation it stopped at. */
export type PublishError = { message: string; code?: string; scope?: string; applied?: number }

export type PublishOutcome =
  | { status: 'published'; result: PublishResult }
  | { status: 'partial'; result: PublishResult }
  | { status: 'confirm'; count: number }
  | { status: 'refused'; message: string }

/**
 * The draft of the Firewalling tab for one connection (UA51): kept in memory and in the session storage of the
 * browser (a reload keeps it, another tab or a closed browser does not), published in one call.
 */
export function useFirewallDraft(connectionId: string) {
  const [state, setState] = useState(() => ({ connectionId, draft: parseStoredDraft(readStored(storageKey(connectionId))) }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<PublishError | null>(null)
  const [publishedAt, setPublishedAt] = useState<string | null>(() => readStored(publishedKey(connectionId)))

  // Another connection: its own draft (adjusted while rendering, not in an effect).
  if (state.connectionId !== connectionId) {
    setState({ connectionId, draft: parseStoredDraft(readStored(storageKey(connectionId))) })
    setPublishedAt(readStored(publishedKey(connectionId)))
    setError(null)
  }
  const draft = state.connectionId === connectionId ? state.draft : EMPTY_DRAFT

  const update = useCallback((change: (d: FirewallDraft) => FirewallDraft) => {
    setState(prev => {
      const next = change(prev.draft)
      writeStored(storageKey(prev.connectionId), Object.keys(next.scopes).length > 0 ? serializeDraft(next) : null)
      return { ...prev, draft: next }
    })
  }, [])

  const derived = useMemo(() => deriveOps(draft), [draft])

  const discard = useCallback(() => {
    update(() => EMPTY_DRAFT)
    setError(null)
  }, [update])

  /**
   * Sends the draft, PUBLISH_MAX_WRITES Proxmox writes at most per call (the first ones: the rest stays in the draft for the
   * next publish). Above PUBLISH_CONFIRM_ABOVE operations, `confirmed` must say the user agreed.
   */
  const publish = useCallback(async (confirmed = false): Promise<PublishOutcome> => {
    const sent = derived
    const batch = firstBatch(sent.ops)
    const count = batch.length
    if (count === 0) return { status: 'refused', message: '' }
    if (count > PUBLISH_CONFIRM_ABOVE && !confirmed) return { status: 'confirm', count }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/firewall/publish/${encodeURIComponent(connectionId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops: batch, digests: sent.digests, confirmed: count > PUBLISH_CONFIRM_ABOVE }),
      })
      const body = await res.json().catch(() => null)
      if (body && typeof body.applied === 'number') {
        const result = body as PublishResult
        const digests = Object.fromEntries(Object.entries(result.scopes ?? {}).map(([k, v]) => [k, v.digest]))
        update(d => rebaseDraft(d, sent, result.applied, digests))
        if (!result.failed) {
          const at = new Date().toISOString()
          setPublishedAt(at)
          writeStored(publishedKey(connectionId), at)
        }
        if (result.failed) {
          setError({ message: result.failed.message, code: result.failed.code, scope: result.failed.scope, applied: result.applied })
          return { status: 'partial', result }
        }
        return { status: 'published', result }
      }
      const message = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
      setError({ message, code: body?.code })
      return { status: 'refused', message }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError({ message })
      return { status: 'refused', message }
    } finally {
      setBusy(false)
    }
  }, [connectionId, derived, update])

  return { draft, update, ops: derived.ops, count: derived.ops.length, discard, publish, busy, error, clearError: () => setError(null), publishedAt }
}
