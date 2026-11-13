'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, LinearProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { isConvertedCluster } from './useHaConfig'
import type { HaConfig } from './useHaConfig'

const LABEL_PREFIX = 'Security upgrade: '
const POLL_MS = 5000
const TOTAL_STEPS = 9

interface UpgradeEvent {
  step: number
  totalSteps: number
  label: string
  status: string
}

interface Props {
  config: HaConfig | undefined
  onChange: () => void | Promise<unknown>
}

/**
 * One-time hardening of a cluster deployed before security level 1: banner,
 * confirmation, live progress on the deploy SSE stream, resume after a failure.
 */
export default function HaSecurityUpgrade({ config, onChange }: Props) {
  const t = useTranslations('ha')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [event, setEvent] = useState<UpgradeEvent | null>(null)
  const [showDone, setShowDone] = useState(false)
  // The upgrade record (updatedAt, error) seen when a start was accepted:
  // the action stays disabled until the config shows another record
  // (running, or failed again before running was ever seen).
  const [startedFrom, setStartedFrom] = useState<{ updatedAt?: string, error?: string } | null>(null)
  const wasRunning = useRef(false)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const deployed = isConvertedCluster(config)
  const level = config?.securityLevel ?? 0
  const upgrade = config?.securityUpgrade ?? null
  const running = deployed && level < 1 && upgrade?.status === 'running'
  const failed = deployed && level < 1 && upgrade?.status === 'failed'
  const recordUpdatedAt = upgrade?.updatedAt
  const recordError = upgrade?.error
  const awaitingRunning = startedFrom !== null && level < 1 && !running &&
    recordUpdatedAt === startedFrom.updatedAt && recordError === startedFrom.error

  useEffect(() => {
    if (running) {
      wasRunning.current = true
    } else if (wasRunning.current && level >= 1) {
      wasRunning.current = false
      setShowDone(true)
    }
  }, [running, level])

  useEffect(() => {
    if (!running) return
    const poll = setInterval(() => { void onChangeRef.current() }, POLL_MS)
    const es = new EventSource('/api/v1/ha/deploy/status')
    es.onmessage = (e) => {
      let data: UpgradeEvent
      try {
        data = JSON.parse(e.data)
      } catch {
        // A malformed frame carries no progress: skip it, the poll keeps
        // the state current.
        return
      }
      if (!data.label?.startsWith(LABEL_PREFIX)) return
      setEvent({ ...data, label: data.label.slice(LABEL_PREFIX.length) })
      if (data.status === 'failed' || (data.status === 'done' && data.step === data.totalSteps)) void onChangeRef.current()
    }
    es.onerror = () => es.close()
    return () => {
      clearInterval(poll)
      es.close()
    }
  }, [running])

  const start = useCallback(async () => {
    setDialogOpen(false)
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/v1/ha/security-upgrade', {
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
  }, [t, recordUpdatedAt, recordError])

  if (!deployed) return null

  const errorAlert = error && (
    <Alert severity='error' sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>
  )

  if (running) {
    const total = event?.totalSteps ?? TOTAL_STEPS
    const step = event?.step ?? (upgrade?.phase ?? 0) + 1
    return (
      <Box sx={{ mb: 2 }}>
        {errorAlert}
        <Alert severity='info' icon={<i className='ri-shield-keyhole-line' />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant='body2' noWrap>
              {event?.label
                ? t('securityUpgrade.progressWithLabel', { step, total, label: event.label })
                : t('securityUpgrade.progress', { step, total })}
            </Typography>
            <LinearProgress variant='determinate' value={Math.min(100, (step / total) * 100)} sx={{ flex: 1, minWidth: 80 }} />
          </Box>
        </Alert>
      </Box>
    )
  }

  if (level >= 1) {
    return showDone
      ? <Alert severity='success' sx={{ mb: 2 }} onClose={() => setShowDone(false)}>{t('securityUpgrade.done')}</Alert>
      : null
  }

  return (
    <Box sx={{ mb: 2 }}>
      {errorAlert}
      <Alert
        severity={failed ? 'error' : 'warning'}
        action={
          <Button color='inherit' size='small' disabled={submitting || awaitingRunning} onClick={() => (failed ? void start() : setDialogOpen(true))}>
            {failed ? t('securityUpgrade.resume') : t('securityUpgrade.apply')}
          </Button>
        }
      >
        {failed
          ? t('securityUpgrade.failed', { error: upgrade?.error || '' })
          : t('securityUpgrade.banner')}
      </Alert>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle>{t('securityUpgrade.dialogTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('securityUpgrade.line1')}</DialogContentText>
          <DialogContentText>{t('securityUpgrade.line2')}</DialogContentText>
          <DialogContentText>{t('securityUpgrade.line3')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant='contained' onClick={() => void start()}>{t('securityUpgrade.confirm')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
