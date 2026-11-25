'use client'

import { useEffect, useRef, useState } from 'react'

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, LinearProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { isConvertedCluster } from './useHaConfig'
import type { HaConfig } from './useHaConfig'
import { useHaRollingRun } from './useHaRollingRun'

const LABEL_PREFIX = 'Security upgrade: '
const TOTAL_STEPS = 9

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
  const [showDone, setShowDone] = useState(false)
  const wasRunning = useRef(false)

  const deployed = isConvertedCluster(config)
  const level = config?.securityLevel ?? 0
  const upgrade = config?.securityUpgrade ?? null
  const running = deployed && level < 1 && upgrade?.status === 'running'
  const failed = deployed && level < 1 && upgrade?.status === 'failed'
  const run = useHaRollingRun({ url: '/api/v1/ha/security-upgrade', labelPrefix: LABEL_PREFIX, running, record: upgrade, onChange })
  const { event, submitting, error } = run
  const awaitingRunning = run.awaitingRunning && level < 1

  useEffect(() => {
    if (running) {
      wasRunning.current = true
    } else if (wasRunning.current && level >= 1) {
      wasRunning.current = false
      setShowDone(true)
    }
  }, [running, level])

  const start = () => {
    setDialogOpen(false)
    void run.start()
  }

  if (!deployed) return null

  const errorAlert = error && (
    <Alert severity='error' sx={{ mb: 2 }} onClose={run.clearError}>{error}</Alert>
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
          <Button color='inherit' size='small' disabled={submitting || awaitingRunning} onClick={() => (failed ? start() : setDialogOpen(true))}>
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
          <Button variant='contained' onClick={start}>{t('securityUpgrade.confirm')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
