'use client'

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'

/**
 * One in-flight request bound to the selection it was started for.
 *
 * `signal` goes to `fetch` so the browser drops the request as soon as the
 * selection moves on; `isCurrent()` gates every state write after an await,
 * including those of a request whose fetch could not take the signal.
 */
export interface SelectionRequest {
  readonly key: string | null
  readonly signal: AbortSignal
  isCurrent: () => boolean
}

export interface SelectionGuard {
  /** Request bound to the selection that is current right now. */
  beginCurrent: () => SelectionRequest
  /**
   * Request bound to `forKey`, the selection a closure was created for. When
   * that selection is no longer current (a delayed refresh firing after the
   * user moved on) the request is born aborted, so its caller writes nothing.
   */
  begin: (forKey: string | null | undefined) => SelectionRequest
  /**
   * Make `nextKey` current right away and bind a request to it, for an event
   * handler that selects and loads in the same tick (before any render).
   */
  switchTo: (nextKey: string | null | undefined) => SelectionRequest
  /** Whether `forKey` is still the current selection. */
  isCurrent: (forKey: string | null | undefined) => boolean
}

type Generation = { key: string | null; controller: AbortController }

const norm = (key: string | null | undefined): string | null => key ?? null

function abortedSignal(): AbortSignal {
  const controller = new AbortController()

  controller.abort()

  return controller.signal
}

function requestFor(gen: Generation, key: string | null): SelectionRequest {
  const signal = gen.key === key ? gen.controller.signal : abortedSignal()

  return { key, signal, isCurrent: () => !signal.aborted }
}

/**
 * Selection generation shared by the loaders of a selection-bound view (a
 * detail panel, a per-connection page, a per-item dialog).
 *
 * Every change of `key` aborts the requests of the previous selection and
 * invalidates their pending writes, so a late answer for A can never land in
 * B's state. It never sends a request of its own: it only cancels and gates.
 *
 * The switch runs in a layout effect, i.e. during the commit of the render
 * that shows B, before any pending response of A can resolve against it.
 */
export function useSelectionGuard(key: string | null | undefined): SelectionGuard {
  const current = norm(key)
  const genRef = useRef<Generation | null>(null)

  if (genRef.current === null) genRef.current = { key: current, controller: new AbortController() }

  const switchGeneration = useCallback((nextKey: string | null) => {
    const gen = genRef.current!

    if (gen.key === nextKey && !gen.controller.signal.aborted) return gen

    gen.controller.abort()
    const next = { key: nextKey, controller: new AbortController() }

    genRef.current = next

    return next
  }, [])

  useLayoutEffect(() => {
    switchGeneration(current)
  }, [current, switchGeneration])

  // Leaving the view cancels whatever is still in flight.
  useLayoutEffect(() => () => genRef.current?.controller.abort(), [])

  const beginCurrent = useCallback(() => {
    const gen = genRef.current!

    return requestFor(gen, gen.key)
  }, [])

  const begin = useCallback((forKey: string | null | undefined) => requestFor(genRef.current!, norm(forKey)), [])

  const switchTo = useCallback((nextKey: string | null | undefined) => {
    const k = norm(nextKey)

    return requestFor(switchGeneration(k), k)
  }, [switchGeneration])

  const isCurrent = useCallback((forKey: string | null | undefined) => {
    const gen = genRef.current!

    return gen.key === norm(forKey) && !gen.controller.signal.aborted
  }, [])

  return useMemo(() => ({ beginCurrent, begin, switchTo, isCurrent }), [beginCurrent, begin, switchTo, isCurrent])
}
