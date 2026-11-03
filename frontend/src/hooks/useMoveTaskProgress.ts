'use client'

import { useEffect, useRef, useState } from 'react'

import { isMoveTaskType, type MoveProgress } from '@/lib/tasks/moveProgress'

/** A PVE task row, as the task lists carry it. */
export interface MoveTaskRef {
  upid: string
  connectionId: string
  node: string
  type: string
  status: string
}

/** Moves followed at once; the others show their status chip only. */
export const MAX_POLLED_MOVES = 5

type TailAnswer = { total: number; finished: boolean; progress: MoveProgress | null }

async function readTail(task: MoveTaskRef, from: number): Promise<TailAnswer | null> {
  try {
    const url = `/api/v1/tasks/${encodeURIComponent(task.connectionId)}/${encodeURIComponent(task.node)}/${encodeURIComponent(task.upid)}?tail=1&from=${from}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null

    return (await res.json()) as TailAnswer
  } catch {
    return null
  }
}

/**
 * Progress of the running disk and volume moves among `tasks` (roadmap#196),
 * keyed by UPID. Each round reads the tail of each move's log, one move after
 * the other, then waits `intervalMs`; 0 stops polling (rows not on screen, tab
 * hidden). A move passes back the line count it got, so a poll reads only the
 * lines written since, and a move whose log closed is not asked again.
 */
export function useMoveTaskProgress(tasks: ReadonlyArray<MoveTaskRef>, intervalMs: number): Record<string, MoveProgress> {
  const [progress, setProgress] = useState<Record<string, MoveProgress>>({})
  // Kept across rounds and list changes: where each log was read up to, and which ended.
  const offsets = useRef(new Map<string, number>())
  const ended = useRef(new Set<string>())

  const watched = tasks.filter(task => task.status === 'running' && isMoveTaskType(task.type)).slice(0, MAX_POLLED_MOVES)
  const key = watched.map(task => `${task.connectionId}|${task.node}|${task.upid}`).join(',')

  useEffect(() => {
    if (!intervalMs || watched.length === 0) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    // One request at a time: each task is read once the previous answer is in,
    // chained by recursion rather than an await inside a loop.
    const readFrom = async (index: number): Promise<void> => {
      if (cancelled || index >= watched.length) return
      const task = watched[index]
      if (!ended.current.has(task.upid)) {
        const answer = await readTail(task, offsets.current.get(task.upid) ?? 0)
        if (cancelled) return
        if (answer) {
          offsets.current.set(task.upid, answer.total)
          if (answer.finished) ended.current.add(task.upid)
          const next = answer.progress
          if (next) setProgress(prev => ({ ...prev, [task.upid]: next }))
        }
      }
      return readFrom(index + 1)
    }

    const round = async () => {
      await readFrom(0)
      if (!cancelled) timer = setTimeout(() => void round(), intervalMs)
    }

    void round()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // `key` stands for `watched`: a new array with the same rows must not restart the rounds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs])

  const shown: Record<string, MoveProgress> = {}
  for (const task of watched) {
    if (progress[task.upid]) shown[task.upid] = progress[task.upid]
  }

  return shown
}
