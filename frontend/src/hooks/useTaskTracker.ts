'use client'

import { useCallback, useRef } from 'react'
import { useToast } from '@/contexts/ToastContext'

interface TaskInfo {
  upid: string
  connId: string
  node: string
  description: string
  onSuccess?: () => void
  onError?: (error: string) => void
}

interface TaskStatus {
  status: 'running' | 'stopped' | 'error'
  exitstatus?: string
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
  const activeTasksRef = useRef<Set<string>>(new Set())

  const pollTaskStatus = useCallback(async (
    connId: string,
    node: string,
    upid: string
  ): Promise<TaskStatus> => {
    const res = await fetch(
      `/api/v1/tasks/${encodeURIComponent(connId)}/${encodeURIComponent(node)}/${encodeURIComponent(upid)}`
    )

    if (!res.ok) {
      throw new Error(`Failed to get task status: ${res.status}`)
    }

    const json = await res.json()
    return json
  }, [])

  const trackTask = useCallback(async (taskInfo: TaskInfo) => {
    const { upid, connId, node, description, onSuccess, onError } = taskInfo

    // Éviter de tracker la même tâche deux fois
    if (activeTasksRef.current.has(upid)) {
      return
    }

    activeTasksRef.current.add(upid)

    // Toast initial
    toast.info(`${description}...`)

    const pollInterval = 2000 // 2 secondes
    const maxAttempts = 150 // 5 minutes max (150 * 2s)
    let attempts = 0

    const poll = async () => {
      try {
        attempts++
        const status = await pollTaskStatus(connId, node, upid)

        if (status.status === 'stopped') {
          // Tâche terminée
          activeTasksRef.current.delete(upid)

          if (status.exitstatus === 'OK') {
            toast.success(`${description} - Terminé`)
            onSuccess?.()
          } else {
            const errorMsg = status.exitstatus || 'Erreur inconnue'
            toast.error(`${description} - Échec: ${errorMsg}`)
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
          toast.warning(`${description} - Timeout (tâche peut-être encore en cours)`)
        }
      } catch (e: any) {
        activeTasksRef.current.delete(upid)
        toast.error(`${description} - Erreur: ${e.message}`)
        onError?.(e.message)
      }
    }

    // Démarrer le polling après un court délai
    setTimeout(poll, pollInterval)
  }, [toast, pollTaskStatus])

  return { trackTask }
}
