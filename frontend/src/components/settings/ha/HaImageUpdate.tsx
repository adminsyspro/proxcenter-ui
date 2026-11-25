'use client'

import { Fragment, useEffect, useRef, useState } from 'react'

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { isConvertedCluster, useHaImages } from './useHaConfig'
import type { HaConfig } from './useHaConfig'
import { useHaRollingRun } from './useHaRollingRun'

const LABEL_PREFIX = 'Image update: '
const TOTAL_STEPS = 3

// What the confirmation states, one fact per line: label, then value.
const DIALOG_ROWS = [
  { key: 'order', icon: 'ri-list-ordered' },
  { key: 'outage', icon: 'ri-timer-line' },
  { key: 'ui', icon: 'ri-window-line' },
  { key: 'data', icon: 'ri-database-2-line' }
] as const

interface Props {
  config: HaConfig | undefined
  onChange: () => void | Promise<unknown>
}

/**
 * Rolling update of the etcd and HAProxy images of a hardened cluster whose
 * nodes still name the tags they were converted with: banner, confirmation,
 * live progress on the deploy SSE stream, restart after a failure.
 */
export default function HaImageUpdate({ config, onChange }: Props) {
  const t = useTranslations('ha')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const wasRunning = useRef(false)

  // A cluster not hardened yet gets these images from the security upgrade.
  const applies = isConvertedCluster(config) && (config?.securityLevel ?? 0) >= 1
  const update = config?.imageUpdate ?? null
  const running = applies && update?.status === 'running'
  const failed = applies && update?.status === 'failed'
  const { data: images, mutate: refreshImages } = useHaImages(applies)
  const run = useHaRollingRun({ url: '/api/v1/ha/images/update', labelPrefix: LABEL_PREFIX, running, record: update, onChange })
  const { event, submitting, error } = run
  const finished = update?.status === 'done'

  // The confirmation shows when a run seen running here ends done: state
  // adjusted while rendering, on the change of `running`.
  const [prevRunning, setPrevRunning] = useState(running)

  if (prevRunning !== running) {
    setPrevRunning(running)
    if (prevRunning && finished) setShowDone(true)
  }

  // The nodes are asked again once a run seen here is over, done or failed.
  useEffect(() => {
    if (running) {
      wasRunning.current = true

      return
    }

    if (wasRunning.current) {
      wasRunning.current = false
      void refreshImages()
    }
  }, [running, refreshImages])

  const start = () => {
    setDialogOpen(false)
    void run.start()
  }

  if (!applies) return null

  const errorAlert = error && (
    <Alert severity='error' sx={{ mb: 2 }} onClose={run.clearError}>{error}</Alert>
  )

  if (running) {
    const total = event?.totalSteps ?? TOTAL_STEPS
    const step = event?.step ?? (update?.phase ?? 0) + 1

    return (
      <Box sx={{ mb: 2 }}>
        {errorAlert}
        <Alert severity='info' icon={<i className='ri-refresh-line' />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant='body2' noWrap>
              {event?.label
                ? t('imageUpdate.progressWithLabel', { step, total, label: event.label })
                : t('imageUpdate.progress', { step, total })}
            </Typography>
            <LinearProgress variant='determinate' value={Math.min(100, (step / total) * 100)} sx={{ flex: 1, minWidth: 80 }} />
          </Box>
        </Alert>
      </Box>
    )
  }

  if (!failed && !images?.outdated) {
    return showDone
      ? <Alert severity='success' sx={{ mb: 2 }} onClose={() => setShowDone(false)}>{t('imageUpdate.done')}</Alert>
      : errorAlert || null
  }

  return (
    <Box sx={{ mb: 2 }}>
      {errorAlert}
      <Alert
        severity={failed ? 'error' : 'warning'}
        action={
          <Button color='inherit' size='small' sx={{ whiteSpace: 'nowrap' }} disabled={submitting || run.awaitingRunning} onClick={() => (failed ? start() : setDialogOpen(true))}>
            {failed ? t('imageUpdate.retry') : t('imageUpdate.apply')}
          </Button>
        }
      >
        {failed
          ? t('imageUpdate.failed', { error: update?.error || '' })
          : t('imageUpdate.banner', { etcd: images?.etcd ?? '', haproxy: images?.haproxy ?? '' })}
      </Alert>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth='md'>
        <DialogTitle>{t('imageUpdate.dialogTitle')}</DialogTitle>
        <DialogContent sx={{ pt: '20px !important' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', columnGap: 2, rowGap: 1.5, alignItems: 'center' }}>
            {DIALOG_ROWS.map(row => (
              <Fragment key={row.key}>
                <Box component='i' className={row.icon} sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography variant='body2' noWrap sx={{ fontWeight: 600 }}>{t(`imageUpdate.${row.key}Label`)}</Typography>
                <Typography variant='body2' noWrap color='text.secondary'>{t(`imageUpdate.${row.key}`)}</Typography>
              </Fragment>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant='contained' onClick={start}>{t('imageUpdate.confirm')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
