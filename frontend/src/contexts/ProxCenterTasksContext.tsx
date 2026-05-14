'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// ---- Types ----

export type PCTaskStatus = 'running' | 'done' | 'error'

export interface PCTask {
  id: string
  type: 'upload' | 'download' | 'generic'
  label: string
  detail?: string
  progress: number        // 0–100
  status: PCTaskStatus
  error?: string
  createdAt: number
}

interface ProxCenterTasksContextValue {
  tasks: PCTask[]
  addTask: (task: PCTask) => void
  updateTask: (id: string, updates: Partial<PCTask>) => void
  removeTask: (id: string) => void
  clearDone: () => void
  registerOnRestore: (id: string, cb: () => void) => void
  unregisterOnRestore: (id: string) => void
  restoreTask: (id: string) => void
}

const STORAGE_KEY = 'proxcenter-tasks'

const ProxCenterTasksContext = createContext<ProxCenterTasksContextValue | null>(null)

// ---- Helpers ----

function loadTasks(): PCTask[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)

    if (!raw) return []

return JSON.parse(raw) as PCTask[]
  } catch {
    return []
  }
}

function saveTasks(tasks: PCTask[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
  } catch { /* quota exceeded, ignore */ }
}

// ---- Provider ----

export function ProxCenterTasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<PCTask[]>([])
  const restoreCallbacks = useRef<Map<string, () => void>>(new Map())
  const hydrated = useRef(false)

  // Hydrate from sessionStorage on mount
  useEffect(() => {
    const stored = loadTasks()

    if (stored.length > 0) {
      // Mark running tasks: try to resume polling for uploads, otherwise mark interrupted
      const recovered = stored.map(t => {
        if (t.status === 'running') {
          // We'll check server-side progress for uploads
          if (t.type === 'upload') return t // keep as running, will be checked below

return { ...t, status: 'error' as PCTaskStatus, error: 'Interrupted by page reload' }
        }


return t
      })

      setTasks(recovered)

      // For running uploads, poll server to see if phase 2 is still going
      const runningUploads = recovered.filter(t => t.status === 'running' && t.type === 'upload')

      for (const task of runningUploads) {
        resumeUploadPolling(task.id)
      }
    }

    hydrated.current = true
  }, [])

  // Persist to sessionStorage whenever tasks change (after hydration)
  useEffect(() => {
    if (hydrated.current) {
      saveTasks(tasks)
    }
  }, [tasks])

  // Resume polling for a server-side upload transfer
  const resumeUploadPolling = (uploadId: string) => {
    let attempts = 0

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/upload-progress/${uploadId}`)

        if (!res.ok) {
          // Progress endpoint gone (server restarted or 30s cleanup elapsed)
          clearInterval(poll)
          setTasks(prev => prev.map(t =>
            t.id === uploadId && t.status === 'running'
              ? { ...t, status: 'error', error: 'Lost connection after reload' }
              : t
          ))

return
        }

        const data = await res.json()

        if (data.status === 'done') {
          clearInterval(poll)
          setTasks(prev => prev.map(t =>
            t.id === uploadId ? { ...t, progress: 100, status: 'done' } : t
          ))
        } else if (data.status === 'error') {
          clearInterval(poll)
          setTasks(prev => prev.map(t =>
            t.id === uploadId ? { ...t, status: 'error', error: data.error || 'Transfer failed' } : t
          ))
        } else if (data.status === 'transferring') {
          const pct = data.totalBytes > 0
            ? Math.round((data.bytesSent / data.totalBytes) * 100)
            : 0


          // Map to 50-100 range (phase 2)
          const taskPct = 50 + Math.round(pct / 2)

          setTasks(prev => prev.map(t =>
            t.id === uploadId ? { ...t, progress: taskPct, detail: t.detail?.replace(/^.*→/, `Sending to Proxmox… ${pct}% →`) } : t
          ))
        }
      } catch {
        attempts++

        if (attempts > 5) {
          clearInterval(poll)
          setTasks(prev => prev.map(t =>
            t.id === uploadId && t.status === 'running'
              ? { ...t, status: 'error', error: 'Lost connection after reload' }
              : t
          ))
        }
      }
    }, 1500)
  }

  const addTask = useCallback((task: PCTask) => {
    setTasks(prev => [task, ...prev.filter(t => t.id !== task.id)])
  }, [])

  const updateTask = useCallback((id: string, updates: Partial<PCTask>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
  }, [])

  const removeTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
    restoreCallbacks.current.delete(id)
  }, [])

  const clearDone = useCallback(() => {
    setTasks(prev => {
      prev.forEach(t => { if (t.status !== 'running') restoreCallbacks.current.delete(t.id) })

return prev.filter(t => t.status === 'running')
    })
  }, [])

  const registerOnRestore = useCallback((id: string, cb: () => void) => {
    restoreCallbacks.current.set(id, cb)
  }, [])

  const unregisterOnRestore = useCallback((id: string) => {
    restoreCallbacks.current.delete(id)
  }, [])

  const restoreTask = useCallback((id: string) => {
    const cb = restoreCallbacks.current.get(id)

    if (cb) cb()
  }, [])

  return (
    <ProxCenterTasksContext.Provider value={{ tasks, addTask, updateTask, removeTask, clearDone, registerOnRestore, unregisterOnRestore, restoreTask }}>
      {children}
    </ProxCenterTasksContext.Provider>
  )
}

// ---- Hook ----

export function useProxCenterTasks() {
  const ctx = useContext(ProxCenterTasksContext)

  if (!ctx) throw new Error('useProxCenterTasks must be used inside ProxCenterTasksProvider')

return ctx
}
