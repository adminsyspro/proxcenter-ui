'use client'

import { useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useToast } from '@/contexts/ToastContext'

interface TaskInfo {
  upid: string
  connId: string
  node: string
  description: string
  onSuccess?: () => void
  onError?: (error: string) => void
  queryParams?: Record<string, string>
  /** How long to follow the task before giving up. Default 5 minutes. */
  timeoutMs?: number
}

interface TaskStatus {
  status: 'running' | 'stopped' | 'error'
  exitstatus?: string
  /** Why the task failed, read by the task route from the PVE log (#926). */
  failureReason?: string | null
  type?: string
}

/**
 * Hook pour suivre les tâches Proxmox jusqu'à leur completion.
 *
 * Usage:
 * const { trackTask } = useTaskTracker()
 *
 * // Après un appel API qui retourne un UPID
 * trackTask({
 *   upid: response.data,
 *   connId: 'my-conn',
 *   node: 'pve1',
 *   description: 'Démarrage de la VM',
 *   onSuccess: () => console.log('Done!'),
 *   onError: (err) => console.error(err),
 * })
 */
export function useTaskTracker() {
  const toast = useToast()
  const t = useTranslations()
  const activeTasksRef = useRef<Set<string>>(new Set())

  const pollTaskStatus = useCallback(async (
    connId: string,
    node: string,
    upid: string,
    queryParams?: Record<string, string>
  ): Promise<TaskStatus> => {
    let url = `/api/v1/tasks/${encodeURIComponent(connId)}/${encodeURIComponent(node)}/${encodeURIComponent(upid)}`
    if (queryParams) {
      const params = new URLSearchParams(queryParams).toString()
      if (params) url += `?${params}`
    }
    const res = await fetch(url)

    if (!res.ok) {
      throw new Error(`Failed to get task status: ${res.status}`)
    }

    const json = await res.json()
    return json
  }, [])

  const trackTask = useCallback((taskInfo: TaskInfo) => {
    const { upid, connId, node, description, onSuccess, onError, queryParams, timeoutMs } = taskInfo

    // Éviter de tracker la même tâche deux fois
    if (activeTasksRef.current.has(upid)) {
      return Promise.resolve()
    }

    activeTasksRef.current.add(upid)

    // Toast initial
    toast.info(`${description}...`)

    const pollInterval = 2000 // 2 secondes
    const maxAttempts = Math.max(1, Math.round((timeoutMs ?? 300_000) / pollInterval)) // 5 minutes by default
    let attempts = 0

    const poll = async () => {
      try {
        attempts++
        const status = await pollTaskStatus(connId, node, upid, queryParams)

        if (status.status === 'stopped') {
          // Tâche terminée
          activeTasksRef.current.delete(upid)

          if (status.exitstatus === 'OK') {
            toast.success(t('taskTracker.completed', { description }))
            onSuccess?.()
          } else {
            const errorMsg = status.failureReason || status.exitstatus || t('taskTracker.unknownError')
            toast.error(t('taskTracker.failed', { description, error: errorMsg }))
            onError?.(errorMsg)
          }

          return
        }

        // Tâche toujours en cours
        if (attempts < maxAttempts) {
          setTimeout(poll, pollInterval)
        } else {
          // Timeout
          activeTasksRef.current.delete(upid)
          toast.warning(t('taskTracker.timeout', { description }))
        }
      } catch (e: any) {
        activeTasksRef.current.delete(upid)
        toast.error(t('taskTracker.error', { description, error: e.message }))
        onError?.(e.message)
      }
    }

    // Démarrer le polling après un court délai
    setTimeout(poll, pollInterval)
    return Promise.resolve()
  }, [toast, t, pollTaskStatus])

  return { trackTask }
}
