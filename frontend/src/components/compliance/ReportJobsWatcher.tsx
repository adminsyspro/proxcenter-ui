'use client'

import { useEffect, useRef } from 'react'

import { useTranslations } from 'next-intl'

import { useProxCenterTasks, type PCTask } from '@/contexts/ProxCenterTasksContext'
import { useToast } from '@/contexts/ToastContext'
import { triggerUrlDownload } from '@/components/compliance/frameworksTab.helpers'

/** The server answers from memory (no Proxmox call): a short period costs nothing. */
export const REPORT_JOB_POLL_MS = 3000

type JobState = { status: 'running' | 'done' | 'error'; error?: string } | { status: 'gone' }

async function readJob(statusUrl: string): Promise<JobState | null> {
  try {
    const res = await fetch(statusUrl, { cache: 'no-store' })
    // Expired, server restarted, or not the caller's: nothing will ever come of it.
    if (res.status === 404) return { status: 'gone' }
    if (!res.ok) return null
    const json = await res.json()

    return json?.data?.status ? json.data : null
  } catch {
    // Network blip: try again on the next tick.
    return null
  }
}

/**
 * Follows the background compliance reports of the ProxCenter taskbar, from
 * any page and across a reload, and tells the user when one is ready with a
 * download button. Mounted once, next to the taskbar.
 */
export default function ReportJobsWatcher() {
  const t = useTranslations('compliance.frameworks')
  const toast = useToast()
  const { tasks, updateTask } = useProxCenterTasks()

  const running = tasks.filter(task => task.status === 'running' && !!task.statusUrl)
  const runningRef = useRef<PCTask[]>(running)
  const busy = useRef(false)
  // The toast context hands a new object on every render: read through refs so
  // the timer is not torn down each time a toast shows.
  const toastRef = useRef(toast)
  const tRef = useRef(t)

  // Written after render, never during it (unsafe under concurrent rendering).
  useEffect(() => {
    runningRef.current = running
    toastRef.current = toast
    tRef.current = t
  })

  const hasRunning = running.length > 0

  useEffect(() => {
    if (!hasRunning) return

    const tick = async () => {
      if (busy.current) return
      busy.current = true
      const tr = tRef.current
      try {
        const followed = runningRef.current
        const states = await Promise.all(followed.map(task => readJob(task.statusUrl as string)))

        followed.forEach((task, i) => {
          const job = states[i]
          if (!job || job.status === 'running') return

          if (job.status === 'done') {
            updateTask(task.id, { status: 'done', progress: 100, finishedAt: Date.now() })
            const downloadUrl = task.downloadUrl
            toastRef.current.showToast(
              tr('reportReady', { report: task.label }),
              'success',
              20_000,
              downloadUrl
                ? { label: tr('reportDownload'), onClick: () => { triggerUrlDownload(downloadUrl); updateTask(task.id, { dismissed: true }) } }
                : undefined,
            )
          } else {
            const error = job.status === 'gone' ? tr('reportExpired') : job.error || tr('reportFailed')

            updateTask(task.id, { status: 'error', error, finishedAt: Date.now() })
            toastRef.current.error(`${task.label}: ${error}`, 8000)
          }
        })
      } finally {
        busy.current = false
      }
    }

    const timer = setInterval(() => void tick(), REPORT_JOB_POLL_MS)

    return () => clearInterval(timer)
  }, [hasRunning, updateTask])

  return null
}
