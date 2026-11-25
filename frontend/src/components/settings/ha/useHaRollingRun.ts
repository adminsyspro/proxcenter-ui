'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslations } from 'next-intl'

const POLL_MS = 5000

export interface HaRunEvent {
  step: number
  totalSteps: number
  label: string
  status: string
}

interface RunRecord {
  updatedAt?: string
  error?: string
}

interface Options {
  /** Route that starts (or resumes) the run. */
  url: string
  /** Prefix of the labels of this run's events on the shared deploy stream. */
  labelPrefix: string
  running: boolean
  record: RunRecord | null | undefined
  onChange: () => void | Promise<unknown>
}

/**
 * A rolling run on the HA cluster (security hardening, image update): the
 * start request, the live progress read on the deploy SSE stream while the
 * run is on, and the config poll that follows its state.
 */
export function useHaRollingRun({ url, labelPrefix, running, record, onChange }: Options) {
  const t = useTranslations('ha')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [event, setEvent] = useState<HaRunEvent | null>(null)
  // The record (updatedAt, error) seen when a start was accepted: the action
  // stays disabled until the config shows another record (running, or failed
  // again before running was ever seen).
  const [startedFrom, setStartedFrom] = useState<RunRecord | null>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const recordUpdatedAt = record?.updatedAt
  const recordError = record?.error
  const awaitingRunning = startedFrom !== null && !running &&
    recordUpdatedAt === startedFrom.updatedAt && recordError === startedFrom.error

  useEffect(() => {
    if (!running) return
    const poll = setInterval(() => { void onChangeRef.current() }, POLL_MS)
    const es = new EventSource('/api/v1/ha/deploy/status')
    es.onmessage = (e) => {
      let data: HaRunEvent
      try {
        data = JSON.parse(e.data)
      } catch {
        // A malformed frame carries no progress: skip it, the poll keeps
        // the state current.
        return
      }
      if (!data.label?.startsWith(labelPrefix)) return
      setEvent({ ...data, label: data.label.slice(labelPrefix.length) })
      if (data.status === 'failed' || (data.status === 'done' && data.step === data.totalSteps)) void onChangeRef.current()
    }
    es.onerror = () => es.close()
    return () => {
      clearInterval(poll)
      es.close()
    }
  }, [running, labelPrefix])

  const start = useCallback(async () => {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setEvent(null)
        setStartedFrom({ updatedAt: recordUpdatedAt, error: recordError })
      }
      else setError(data.error || t('common.operationFailed', { status: res.status }))
      await onChangeRef.current()
    } catch (e: any) {
      setError(e.message || t('common.requestFailed'))
    } finally {
      setSubmitting(false)
    }
  }, [t, url, recordUpdatedAt, recordError])

  return { event, submitting, error, clearError: () => setError(''), awaitingRunning, start }
}
