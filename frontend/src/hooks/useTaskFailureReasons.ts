'use client'

import { useEffect, useState } from 'react'

/** A finished PVE task row the caller wants the failure reason of. */
export interface FailedTaskRef {
  upid: string
  connectionId: string
  node: string
}

/** Rows asked per render pass; the rest wait for the next refresh. */
const MAX_LOOKUPS = 10

// A failed task never changes again, so its reason is cached for the session.
const cache = new Map<string, string>()
const inFlight = new Set<string>()

async function lookup(task: FailedTaskRef): Promise<void> {
  inFlight.add(task.upid)
  try {
    const url = `/api/v1/tasks/${encodeURIComponent(task.connectionId)}/${encodeURIComponent(task.node)}/${encodeURIComponent(task.upid)}?summary=1`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return
    const json = await res.json()
    cache.set(task.upid, typeof json?.failureReason === 'string' ? json.failureReason : '')
  } catch {
    // Left unknown: the row keeps its exitstatus and is asked again later.
  } finally {
    inFlight.delete(task.upid)
  }
}

/**
 * Why each failed PVE task failed (#926), keyed by UPID. The task list only
 * carries the exitstatus ("migration aborted"); the reason lives in the task
 * log, which the task route reads. Only a bounded number of rows is asked at a
 * time, one after the other, and each answer is kept for the session.
 */
export function useTaskFailureReasons(tasks: ReadonlyArray<FailedTaskRef>): Record<string, string> {
  const [, setVersion] = useState(0)
  const key = tasks.map(task => task.upid).join('|')

  useEffect(() => {
    const pending = tasks.filter(task => !cache.has(task.upid) && !inFlight.has(task.upid)).slice(0, MAX_LOOKUPS)
    if (pending.length === 0) return

    let cancelled = false

    void (async () => {
      for (const task of pending) {
        if (cancelled) return
        await lookup(task)
      }
      if (!cancelled) setVersion(v => v + 1)
    })()

    return () => { cancelled = true }
    // `key` stands for `tasks`: a new array with the same rows must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const reasons: Record<string, string> = {}
  for (const task of tasks) {
    const reason = cache.get(task.upid)
    if (reason) reasons[task.upid] = reason
  }

  return reasons
}

/** Test seam: forget every cached reason. */
export function resetTaskFailureReasonCache(): void {
  cache.clear()
  inFlight.clear()
}
