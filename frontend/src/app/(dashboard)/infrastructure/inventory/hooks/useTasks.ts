import { useCallback, useEffect, useState } from 'react'

import type { InventorySelection } from '../types'
import { parseVmId } from '../helpers'
import { useSelectionGuard } from '@/hooks/useSelectionGuard'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface UseTasksParams {
  selection: InventorySelection | null
  detailTab: number
  t: (key: string) => string
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useTasks({ selection, detailTab, t }: UseTasksParams) {
  const [tasks, setTasks] = useState<any[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [tasksLoaded, setTasksLoaded] = useState(false)

  // Requests are bound to the guest they were started for (see resetTasks).
  const guard = useSelectionGuard(selection?.id)

  const loadTasks = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return

    const req = guard.begin(selection.id)

    if (!req.isCurrent()) return

    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`

    setTasksLoading(true)
    setTasksError(null)

    try {
      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/tasks`,
        { cache: 'no-store', signal: req.signal }
      )

      const json = await res.json()

      if (!req.isCurrent()) return

      if (json.error) {
        setTasksError(json.error)
      } else {
        setTasks(json.data?.tasks || [])
        setTasksLoaded(true)
      }
    } catch (e: any) {
      if (req.isCurrent()) setTasksError(e.message || t('errors.loadingError'))
    } finally {
      if (req.isCurrent()) setTasksLoading(false)
    }
  }, [selection, guard])

  // Charger les tâches quand on sélectionne l'onglet Historique des tâches (index 3)
  useEffect(() => {
    if (detailTab === 3 && selection?.type === 'vm' && !tasksLoaded && !tasksLoading) {
      void loadTasks()
    }
  }, [detailTab, selection?.type, selection?.id, tasksLoaded, tasksLoading, loadTasks])

  const resetTasks = useCallback(() => {
    setTasksLoaded(false)
    setTasks([])
    setTasksError(null)
    // The previous guest's load is abandoned by the guard and never clears
    // its own loading flag: release it so the new guest's load can start.
    setTasksLoading(false)
  }, [])

  return {
    tasks,
    tasksLoading,
    tasksError,
    tasksLoaded,
    loadTasks,
    setTasksLoaded,
    resetTasks,
  }
}
